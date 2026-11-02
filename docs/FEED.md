# The update feed

Every Thornswood launcher decides what to download from one file:
`version.json`. It is served from **thornswood.net** (`/feed/version.json`
live, `/feed-dev/version.json` for dev), and since #907 from nowhere else:
the GitHub repository `EvilPatrick06/Thornswood-Releases`, once the feed, its
fallback and the home of the release baseline, is retired. This page is every
field in it, who writes each one, who reads it, and what goes wrong when it is
wrong.

## Where it is and how a launcher reads it

### Host cutover (#649) - live URL shape

Confirmed with Website. Code signing is on since 27 Sep; what it checks and
what it does not is under "Checks on every download".

| What | URL |
| --- | --- |
| Live `version.json` | `https://thornswood.net/feed/version.json` |
| Dev `version.json` | `https://thornswood.net/feed-dev/version.json` |
| Live assets | `https://thornswood.net/feed/assets/<sha256>` |
| Dev assets | `https://thornswood.net/feed-dev/assets/<sha256>` |

- **The request.** The launcher reads `config.json` `UpdateFeedUrl` (a direct
  https GET of `version.json`). Defaults in `Config.AfterLoad`: main -> live
  URL above; `Channel` or `UpdateBranch` `dev` -> dev URL (`Config.cs`,
  `Updater.Check`). Host allowlist includes `thornswood.net`.
- **Conditional, since #445.** `Updater.FromSite` keeps the last document it
  read with the `ETag` the site sent, sends `If-None-Match` on the next check,
  and reads a 304 as that same document. The site answers the tag it issued
  with 304 and no body (`site/lib/serve.js`, the `/feed/version.json` route). The
  launcher asks every thirty seconds while the game runs, and the document is
  about ninety kilobytes, so that is roughly ten megabytes an hour per launcher
  saved without slowing the check down. The tag and the document are held in
  memory, never in `config.json`: a tag without the document it belongs to
  would ask, be told nothing had changed, and have nothing to read.
  `Cache-Control` stays `no-cache`, which means ask every time, so a release is
  still seen inside the server's five minute window.
- **No fallback since #907.** Until then a site feed that did not answer sent
  the check, at most once every five minutes, to the GitHub Contents API on
  `UpdateRepo` (Thornswood-Releases). That is gone from the launcher: a miss is
  what the caller gets, which reads as no answer rather than as no update, so
  the in play countdown clock is left where it is and the next check, thirty
  seconds on, asks the site again. `UpdateRepo` and `UpdateToken` stay in
  `config.json` only so an old one still loads.
- **Launchers in the field.** Every launcher from the #649 cutover on (26 Sep)
  reads the site first, so deleting the repository changes nothing for it: its
  old fallback asks a repository that answers 404 while the site is down, and
  the site answering is all it needs. A launcher last run before 26 Sep reads
  only GitHub, so once the repository is deleted it finds no feed and has to be
  reinstalled from the site; the Known Issues page (written from the issue
  board, #3140) says so to the person.

### Downloads come from the site (#897)

Asked for by Patrick on 28 Sep: "let's get it so we don't need the repo and we
use the website".

- **Where the bytes are.** On the VPS, `C:\Thornswood-Docs\feed\assets\<sha256>`
  and `C:\Thornswood-Docs\feed-dev\assets\<sha256>`, served by `site\lib\serve.js`
  at the asset urls in the table above, with Range resume and immutable
  caching. Each channel has its own folder and holds its own copy: a file both
  feeds name is stored twice, once in each. The route answers only a name of
  64 lowercase hex characters; there is no listing of the folder, and a
  `.part` left by a dropped send is never served.
- **What is up there, 28 Sep.** The one-off copy below was run that day: it
  sent 2 assets to `feed` (6.7 MB) and 25 to `feed-dev` (339.6 MB), each
  checked against the feed's sha256 first, and wrote no `version.json`. After
  it, every asset both live feeds name answers at its site url with the size
  GitHub recorded for it (77 of 77 on main, 94 of 94 on dev). On disk: `feed`
  79 files, 371 MB; `feed-dev` 100 files, 564 MB; 75 files (354 MB) are in
  both. Ten files no feed names any more (old launchers and client runtimes,
  35 MB) and two old `version.json` copies in `feed-dev` are left for a person
  to clear.
- **How a release gets there.** `Publish-Update.ps1` sends every pack, the
  launcher and the client runtime with `Remirror-Site-Feed.ps1 -Send` (scp to
  `<sha256>.part`, then renamed) BEFORE `version.json` is written, and names
  them by their site url. An asset that does not land stops the publish with
  the feed untouched. The `-AssetHost github` path it kept for rolling back
  went with the repository (#907).
- **The urls already on a feed** move over with `Move-FeedUrlsToSite`
  (`Feed-Rules.ps1`): each GitHub url whose bytes the site answers for (a HEAD
  on the asset url, and its size when the feed gives one) is rewritten, and any
  other stays. Every Ship does it for its own channel;
  `Repair-Manifest.ps1 -MoveToSite` does it without a release and sends the
  feed.
- **The old bytes** went up once with `scripts\oneoff\Copy-ReleaseAssets-ToSite.ps1`,
  which read both live feeds, downloaded each missing asset, checked it against
  the feed's sha256 and sent it. It never wrote a feed. It reads GitHub, so it
  does nothing once the repository is gone.
- **Launchers in the field** need nothing new: `thornswood.net` has been on the
  host allow list since before 25 Sep, and a download is checked for https, the
  host and the sha256, plus the signer for a launcher exe (see "Checks on every
  download").

### And from this repository's Releases (#3686)

Patrick decided on 26 Oct, for going public: downloads and updates move to
this repository's Releases. The addresses a launcher asks do not move.

- **Every launcher keeps asking the site.** `thornswood.net/feed[-dev]/version.json`
  and `/feed[-dev]/assets/<sha256>` stay the only addresses. A launcher from
  1.2.6 on builds every asset address from the feed's own folder (the split
  feed above, and `Sync.cs` `AssetFolder` for a record's files), so a feed
  that named github.com instead would not reach it; older ones were given
  these site addresses in their feeds.
- **The site sends them to the Release.** `release-files.yml` puts every file
  a release names on a GitHub Release on the release's own tag
  (`release/main/<id>`, `release/dev/<id>`, the tag Ship already makes), each
  named by its sha256, plus `Thornswood-Setup.exe` on a main one. Once GitHub,
  asked without a token, lists that Release with a file under its sha256,
  with that sha256 as GitHub's own digest and the site's size, the site
  answers the asset with a 302 to the Release's copy (`site/lib/feed.js`,
  "release copies"); `/file/Thornswood-Setup.exe` does the same for the
  installer the site lists. The Downloads page, the bot's links and the
  installer keep their thornswood.net addresses and follow the same
  redirect.
- **Old launchers.** Read in the code of launchers 1.1.103, 1.1.105 and 1.2.5
  (their tags) and of main: each fetches with .NET's WebClient or
  HttpWebRequest, which follow a redirect, allows `github.com`,
  `objects.githubusercontent.com` and `release-assets.githubusercontent.com`
  (`Updater.cs` `AllowedHosts`), checks the address it was given before it
  asks, and checks the sha256 of what arrives, and the signer of a launcher
  exe. A dropped Range on the redirect is a whole new download, which every
  one of them already handles.
- **The site's copy stays.** Every file still goes to the site first
  (`Publish-Update.ps1`), and the site sends it itself whenever the Release
  does not hold it: before the Release is made, for a release the Release
  list has not shown yet, after a rollback (no tag), and for the `settings`
  asset, which only the site has.
- **Only while the repository is public.** A private repository's Release
  answers 404 to a launcher, and one made now would go public with the
  repository, with whatever it holds. So `release-files.yml` is skipped while
  the repository is private, and the site keeps sending every file. The first
  Releases are made after Patrick makes the repository public, which he does
  after #3721's blockers, the files other people own among them (#2454,
  #3602, #3715, #2791), are cleared. Right after the flip, run it for the
  live releases by hand (the tag names are in the feeds' `release.tag`):
  `gh workflow run release-files.yml --ref main -f tag=release/main/<id>`
  and the same for dev's.
- **What starts it.** A release tag pushed from One (`push: tags`), and
  `git-ref.yml` after a release tag it made for a cloud Ship, since a tag the
  run's own token makes starts no workflow. Since #3686 the tag's message
  names the sha256 of the record, the launcher, the client runtime, the
  notes and the signed manifest with its catalog (`Get-ReleaseFileShas`,
  `Release-Name.ps1`), so the files of an older release are still known
  after later Ships; a tag from before names none, and then the channel's
  live feed is read while it still names that release.
- **What it never does.** It never changes a published Release: one that
  lacks a file stops the run. It publishes a Release only after GitHub's own
  digest of every file is right. It runs on GitHub's hosted runner, never on
  the box. `tests\test-3686-release-files.ps1` and `site\tests\test-release-copies.js`
  hold both halves.

### The feed store on the VPS (#907)

Patrick, 28 Sep: "I just want the repo deleted in general if we won't be using
it anymore". Until then every script that edits a feed pulled, committed and
pushed a clone of Thornswood-Releases beside the repository, and the baseline
Ship diffs against (`published.json`) was committed there too. Both live on
the VPS now, beside the feed the site already serves:

| On the VPS | What | Served |
| --- | --- | --- |
| `C:\Thornswood-Docs\feed\version\<8 digits>.json` | every feed ever sent, one new file each, never replaced or deleted; the newest is the live feed (#2727) | the newest, as `/feed/version.json` |
| `C:\Thornswood-Docs\feed\published.json` | the live baseline | no |
| `C:\Thornswood-Docs\feed\launchers.txt` | every launcher version the channel has published, oldest first | no |
| `C:\Thornswood-Docs\feed\releases.txt` | every release the feed has named, oldest first, one tab separated line each: id, channel, launcher, packs, baseline, commit, tag (#444, `Get-FeedStoreReleases`) | no |
| `C:\Thornswood-Docs\feed\releases.json` | the record of each of the last thirty releases, newest first, which `Rollback-Feed.ps1` goes back to (#442); `"releases"` in version.json until #1050. Received and sent by name beside the feed (`Get-StoreReleases`, `Save-StoreReleases` in `Release-Baseline.ps1`) | no |
| `C:\Thornswood-Docs\feed\history\<utc stamp>-<name>` | each of the other files as it was before it was replaced (version.json's history is `version\`) | no |
| `C:\Thornswood-Docs\feed\assets\<sha256>` | the downloads | yes |

and the same under `feed-dev` for dev. `site\lib\serve.js` answers only
`/feed[-dev]/version.json` and `/feed[-dev]/assets/<64 hex>`, so nothing else
in those folders can be fetched: `tests\test-feed-store.ps1` asks a copy of
the site for `published.json`, `launchers.txt`, `history\`, a `.part` and
`read.json` under both and gets 404 for each. Deploy-Docs denies the site
process write to both folders (#923), so only a publisher over ssh writes them.

- **The one piece of code.** `scripts\release\Feed-Store.ps1`. `Receive-FeedStore`
  fetches the files into this machine's working folder for the channel,
  `%LOCALAPPDATA%\Thornswood\feed\main` or `\dev` (not a git repository), checks
  each against the sha256 the VPS gave for it, writes `read.json` with those
  sha256s, and keeps the last twenty of each in `backup\`. `Send-FeedStore`
  sends a file back to `<name>.part` and, in one step on the VPS, checks that
  every file this folder read still has the sha256 it had, then puts each in.
  `version.json` goes in as a new file, `version\<8 digits>.json` one past the
  newest, renamed to a name that is not there yet, and the one before stays;
  nothing ever replaces or deletes a generation, and the site and the store
  read the newest (#2727). The other files are copied into `history\` and
  the `.part` renamed over them in one call (`Move-FeedStoreInto`), so a send
  stopped there leaves the old file or the new one whole. Until #2591 (16 Oct) it was `File.Replace`, which
  moves the old file aside first and left it missing when stopped between
  the two. From #2591 to #2727 (18 Oct) it was MoveFileEx with
  MOVEFILE_REPLACE_EXISTING, which Windows refuses with "Access is denied"
  while any handle is open on the old file, and the site opens version.json
  for every launcher's feed check, so a Ship could stop with NOT SHIPPED
  because somebody's launcher asked at that moment. The rename now keeps
  POSIX semantics (SetFileInformationByHandle, FileRenameInfoEx): a reader
  that opened the file with share-delete, as the site's node does, keeps the
  old bytes it is reading. A handle opened without share-delete still
  refuses it, so every read of a store file in `Feed-Store.ps1` shares
  delete. What no rename gives is a name that is always there: measured 19
  Oct on the VPS with 6 swappers and 6 readers for 10 s a run, the POSIX
  rename left 363 to 4791 opens of about 300k finding nothing, MoveFileEx
  801 to 4127, a replacing hard link up to 1487, and One showed it too, less
  often. The site opens the feed for every launcher's check, every `/watch`
  tick and every join pass, so a request in a Ship's swap found no feed.
  That is why version.json is never replaced: a generation's name only ever
  appears, and the one before it stays (`feedFile` in `site\lib\feed.js`,
  `tests\test-2727-feed-swap-readers.ps1`). If anything moved up there it
  replaces nothing and throws: that is two publishers at once, the push git
  used to refuse.
- **Who uses it.** Ship and Publish-Update receive both files at the start
  (a run that sends nothing, Ship `-DryRun`, uses what it last received),
  ask again before editing the feed (a feed edited meanwhile is received again
  and the release goes on top; a baseline moved meanwhile stops the release
  with nothing written), send `version.json`, then the baseline. Repair-Manifest,
  Set-Server, Set-Collection, Publish-Server's news entry and Publish-Pack
  receive, edit and send the feed the same way. Remirror-Site-Feed sends
  `version.json` through it too. Main and Dev publish to their own stores.
  A Main Ship never replaces the Dev feed or baseline.
- **The dev number.** Ship climbs a dev build's fourth part past every
  version in `feed-dev\launchers.txt`, which every send of the dev feed adds
  to, and past main's feed as the site serves it. Until #907 it read the same
  out of the dev branch's git history.
- **The move.** `scripts\oneoff\Move-FeedStore-ToVps.ps1` copied the last
  baseline each clone held, and every launcher version its history named, to
  the VPS, read both back byte for byte, and saved the whole repository as a
  git bundle under `%LOCALAPPDATA%\Thornswood\feed`. #907 has the steps.
- **When a baseline is lost.** Put the last good one back from `history\` on
  the VPS or from any shipping machine's `feed\<channel>\backup\`, or run
  `Publish-Update.ps1 -Baseline` after the launcher has brought the game up to
  date.
- **Announce a move.** The feed field `updateFeedUrl`: publish the new URL
  under the old feed first, then move. Shell saves it quietly into
  `config.json`.
- **What the log says.** One line per feed address, written once and again if
  it changes: `Update checks read <url>.` (`Shell.OnVersionDoc`). A check that
  could not be made at all while the game runs writes one line a session with
  what came back (`Shell.CheckUpdatesInPlay`).
- **Parsing.** `VersionDoc.Parse` with the .NET `DataContractJsonSerializer`.
  A byte order mark is skipped. A value of the wrong JSON type can make the
  serializer throw, and then the whole document is unread and every launcher
  reports no answer from the update source and shuts Play. Unknown fields are
  ignored.
- **The remirror.** `scripts\deploy\Remirror-Site-Feed.ps1`, which
  `scripts\release\Publish-PostShip.ps1` runs at the end of every release for
  the channel that shipped, checks every asset the feed names is on the site,
  sends any that are missing, and sends `version.json` last, through the store,
  so the feed never names bytes the site does not hold. After a Ship it finds
  `version.json` already there. `-Check` says what it would send and sends
  nothing. Handed an old clone with `-FeedDir`, it replaces whatever the site
  has, as it always did, and says so.

## A real entry, trimmed

From the live feed as it stood on 26 Sep, then in `EvilPatrick06/Thornswood-Releases` (main, commit a22e4ef).
`packs` holds 69 entries and `news` 40; one of each is shown, trimmed. Nothing
here is a secret: the hashes are public and `discordAppId` is a public
application id (`Config.cs:DiscordAppId`).

```json
{
  "launcherVersion": "1.1.95",
  "launcherUrl": "https://api.github.com/repos/EvilPatrick06/Thornswood-Releases/releases/assets/591560398",
  "launcherSha256": "8dc36e32eb3dde35691e7a68e46195c6354968c3ea01585d03eb53289dca3070",
  "serverAddress": "play.thornswood.net",
  "serverPort": "7777",
  "message": "",
  "packs": [
    {
      "id": "20260915-0030",
      "url": "https://api.github.com/repos/EvilPatrick06/Thornswood-Releases/releases/assets/565069058",
      "sha256": "5bf7ff5c7009e24a8c21e599bb732ba11402035a7a4199d91cdf3180360cf1b3",
      "notes": "Connect your Discord from the launcher"
    }
  ],
  "news": [
    {
      "date": "9-26-2026 10:09 PM",
      "title": "What arrived with launcher 1.1.95",
      "body": "The last main note only said demoting was promoted. This is what players actually got ...",
      "details": ["A sealed scroll opens Thornswood: click to open, Continue to characters; ...", "5 files to download, 48.4 MB"],
      "channel": ""
    }
  ],
  "updateRepo": "EvilPatrick06/Thornswood-Releases",
  "voicePort": "7778",
  "collectionUrl": "https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf",
  "maxOnline": 25,
  "mainVersion": "",
  "voiceUrl": "https://thornswood.net/voice",
  "discordAppId": "1549251507361292418",
  "siteUrl": "https://thornswood.net",
  "presenceImage": "https://thornswood.net/presence.png",
  "collectionRevision": 5,
  "clientRuntime": {
    "url": "https://api.github.com/repos/EvilPatrick06/Thornswood-Releases/releases/assets/591302878",
    "sha256": "efc8debfc3cd480183ab5d229b241e198f06f942b99a50baa50b172891b35726",
    "bytes": 6356315,
    "forkCommit": "5c54e8b9"
  }
}
```

Those `api.github.com/.../releases/assets/<id>` addresses are what the
publisher wrote before #445, and a release published since #445 wrote the
browser download address on the GitHub side. Both stop working when
Thornswood-Releases is deleted, which is why every one is moved to the site
first (#897, #907). A release published since #897 writes the site address.

The dev feed (branch `dev`, commit 12f71c8) has the same shape with
`serverPort` `"7787"`, `voicePort` `"7789"`, `voiceUrl`
`"https://thornswood.net/voice-dev"`, `launcherVersion` `"1.1.95.11"`,
`collectionUrl` ending `7essxf` where main's then ended `ombo2a` (both end
`7essxf` since), pack ids ending `-dev`, and a non-empty `mainVersion`.

## Top-level fields

"Saved" means the launcher writes the value into its own `config.json`, so it
stays after the feed changes, and a later feed can only replace it with
another non-empty value (`ShellUpdate.cs:OnVersionDoc`). Every saved field the
publishing machine's own `config.json` holds is overwritten from it on each Ship
(`Publish-Update.ps1:Whatever this machine's launcher is pointed at`,
`Publish-Update.ps1:@('ServerAddress', 'serverAddress')`), so a wrong value on
that machine moves every launcher. `collectionUrl` and `maxOnline` are the two
saved fields that come from elsewhere, as their rows say.

| Field | Type | Written by | Read by | If wrong or missing |
| --- | --- | --- | --- | --- |
| `launcherVersion` | string, dotted numbers | Nothing since #4825: it stays at the last launcher from before Velopack, so that launcher is never offered the native one as a self-update. A launcher goes out only on its channel's Velopack Releases (`merge-release.yml`, `promote-main.yml`) | The site's join pass for a launcher from before Velopack while its channel has no Velopack setup program (`site/lib/passes.js:feedLaunchers`, with `minLauncher`); a Velopack launcher's number is checked against its Release instead (`site/lib/feed.js:nativePublished`). Main's number for a dev launcher (`MainVersion.cs:MainLauncherVersion`, #5385). Not the launcher's own update: a launcher takes that from its Velopack channel (`VeloUpdate.cs:CheckLauncher`), and Scan goes by the same answer (`Upkeep.cs:LauncherWaiting`) | Not saved. Nothing writes it, so it cannot go wrong by a release. |
| `launcherUrl` | string, https | Nothing since #4825 but the url move of `Feed-Rules.ps1` (#5385); it names the last launcher from before Velopack on the site, `/feed[-dev]/assets/<sha256>` (#897) | `Watch-Outside.ps1` and `Check-Outside.ps1`. No launcher downloads it since #4825 | Must pass the host list below. |
| `launcherSha256` | string, 64 hex | Nothing since #4825; it stays the last launcher from before Velopack's | The launcher's manifest check (`FeedManifest.cs:"launcher " + v.launcherVersion, v.launcherSha256`), which holds the feed to its signed release record | Mismatch: the manifest check refuses the feed. |
| `serverAddress` | string | `Publish-Update.ps1:@('ServerAddress', 'serverAddress')` from config `ServerAddress`; `Set-Server.ps1:@('serverAddress', $Address)`. Not `Set-Vps.ps1`, which moves the launcher's built-in address and leaves the feed to `Set-Server.ps1` (`Set-Vps.ps1:What it does NOT do, because Set-Server.ps1 already does it properly`) | `ShellUpdate.cs:v.serverAddress != cfg.ServerAddress` | Saved, unless the config points at a server on this machine (`SkyMp.IsLocal`: 127.0.0.1, localhost, ::1), which keeps its own address, `serverPort` and `voicePort` (#5020: a restore rehearsal or a developer's own server). A change stops Ship unless `-MoveServer` (`Publish-Update.ps1:-not $MoveServer -and -not $Dev`); the dev channel skips that check. Wrong: everybody connects to the wrong box. |
| `serverPort` | string | as above, `ServerPort` | `ShellUpdate.cs:OnVersionDoc` | Saved. Must be a string; the launcher field is a string. |
| `maxOnline` | number | `Publish-Update.ps1`, from `records\most-online.json` by way of `scripts\deploy\MaxOnline.ps1` (#481): the channel's seats, people and staff seats together (30 on main, 5 on dev from its `dev` numbers; Patrick, 12 Oct) | `ShellUpdate.cs:v.maxOnline > 0` | Saved when above 0. Written as a number because a quoted `"30"` reads as 0. It is the M of "N of M awake". The Play page prefers the number the running server announces as `max` in its `online.json` (`Online.cs`), which is the same seats. |
| `collectionUrl` | string | `Set-Collection.ps1:$doc.collectionUrl = $Url` only; Ship carries it forward untouched | `ShellUpdate.cs:OnVersionDoc` | Saved. The collection the buttons send people to; they open its page for the feed's `collectionRevision` (`Checks.CollectionRevisionUrl`, `.../revisions/<N>`), never the bare page, which Nexus shows at its newest revision (#4115). |
| `collectionRevision` | number | `Publish-Update.ps1:Set-Prop $doc 'collectionRevision' $ShipCollectionRevision`, the revision `records\collection-plugins.json` names; Ship and Publish-Update stop unless the shipping machine's Vortex (or, from the feed, the last release) is on it (`CollectionRevision.ps1`, #3597); from the feed a release behind the record moves up to it, carrying `game\data\last-plugin.json`'s order as its plugin list (`Get-ShipFeedMoveRevision`, `New-ShipFeedMoveLists`, #4069), and unless it is the newest revision published on Nexus (`NexusPublished.ps1`, #4068); `Check-CollectionRevisions.ps1` holds both feeds to Nexus every hour and puts the rebuild on the board | `ShellUpdate.cs:Updater.FeedCollectionRevision = v.collectionRevision`, then `Shell.cs:CollectionProblem` | Not saved. 0 or missing: the launcher says nothing about the collection being behind or ahead. Wrong: lets an install on an old revision in (both feeds said 2 while the collection was on 5, #3597), or tells people to reinstall a collection that is fine. |
| `updateRepo` | string `owner/name` | Nobody since #907: `Publish-Update.ps1` takes it out of the feed | `Feed-Rules.ps1` only (a feed that still names one keeps its GitHub pack urls legal until its next Ship) | Launchers from #907 on ignore it. Older ones save it and ask that repository, via the GitHub Contents API, when the site does not answer; once it is deleted that answers 404 and they ask the site again. |
| `updateFeedUrl` | string, https | `Publish-Update.ps1` from `UpdateFeedUrl` (defaults to the site live/dev URL by channel) | `Shell.cs`, `Updater.FeedUrl` | Saved, quietly. The one `version.json` fetch since #907. Publish the new URL under the old feed first, then move. Since #937 only an https address on thornswood.net is used; anything else in `config.json`, empty included, is the built-in live or dev address, so editing the file cannot switch the update check off. |
| `voicePort` | string | from `VoicePort` | `ShellUpdate.cs:v.voicePort != cfg.VoicePort` | Saved, quietly. Was the raw port's number for an empty `voiceUrl`; since #1304 the launcher never connects to the raw port, and this only goes into `Thornswood.ini` for the game. |
| `voiceUrl` | string or absent | `Publish-Update.ps1:Set-Prop $doc 'voiceUrl' $vu`; `-dev` appended on the dev channel (`Publish-Update.ps1:$vu.TrimEnd('/') + '-dev'`) | `ShellUpdate.cs:v.voiceUrl != null && v.voiceUrl != cfg.VoiceUrl` | Saved, quietly. The one field that can be cleared: `""` used to send launchers back to the raw port, and since #1304 gives them the built-in `https://thornswood.net/voice` (`/voice-dev` on the dev build, `Config.Voice`, `Config.VoiceBase`); anything not https is treated the same. Absent changes nothing (`Config.cs:voiceUrl`). |
| `discordAppId`, `siteUrl`, `presenceImage` | string | from config, `Publish-Update.ps1:@('DiscordAppId', 'discordAppId')` | `ShellUpdate.cs:v.discordAppId != cfg.DiscordAppId` | Saved, quietly. The Discord presence card and its buttons. |
| `message` | string | Nobody: set by hand in the feed (received, edited and sent with `Feed-Store.ps1`; `FeedNotice.cs:FeedNotice`) | `FeedNotice.From` (`FeedNotice.cs:From`) | A bar above Play until a feed without it arrives. Never holds Play on its own. |
| `maintenance` | string (read as on only for `true`, `1`, `yes`, `on`) | By hand | `FeedNotice.cs:On` | On: Play held, button says CLOSED FOR MAINTENANCE. Absent in the current feeds. |
| `minLauncher` | string, dotted numbers | `Publish-Update.ps1` on every publish, as the feed's `launcherVersion` (#937) | `FeedNotice.cs:From`; the site's `/api/play/pass` | A launcher below it holds Play, and the site refuses it a join pass, so the game server ends its session. The site also refuses a launcher above `launcherVersion`, a number never published. A value that is not digits and dots is ignored by the launcher, so a typo cannot lock everybody out (`FeedNotice.cs:IsVersion`); the site reads such a value as `launcherVersion`. Updating needs no pass. |
| `packs` | array | `Publish-Update.ps1:Set-Prop $doc 'packs' $packs` appended until #1050; `Repair-Manifest.ps1` removes. Since #1050 `[]` on a channel whose minLauncher syncs to the record (the packs gone block, `Test-FeedPacksGone`) | `Updater.Pending` (`Updater.cs:Pending`) | See below, and "When the packs can go". |
| `optional` | array | `Publish-Pack.ps1:$optional` | Add-ons on the Diagnostics page (`ShellPacks.cs DrawAddons`, #1170), the only place they show since the hidden Mods page went (#3146) | Absent in both feeds today; `scripts/release/optional-packs.txt` lists none. |
| `clientRuntime` | object | `Publish-Update.ps1:Set-Prop $doc 'clientRuntime'`, only when the fork commit or its source notice changed (`Publish-Update.ps1:PUBLISHED ONLY WHEN IT CHANGES`) | `ClientRuntime.Heal` (`ClientRuntime.cs:Heal`) | Null or no `url`: a missing client file cannot be repaired from it. Same host and sha256 checks as a pack. |
| `baseline` | object `{ id, sha256, url, entries, notes? }` | `Publish-Update.ps1` on every release that sends to the site (the release manifest block, #441); taken out by a `-NoUpload` run. `notes`, the release note's title (its first line), since #1050: the update card of a launcher that syncs shows it (`Sync.cs RecordDue`), the packs that used to carry it being off the feed. The whole note is the newest entry of the news file | The launcher from #1050 on, which syncs the install to it (`Updater.SyncRecord`, `launcher\app\Sync.cs`; see "Syncing to the release record"). The next `Publish-Update.ps1`, through `Resolve-ReleaseBaseline` (`Release-Baseline.ps1`) | The release record: what that release left installed, every file of ours as `<bytes>:<sha256>`, at `/feed[-dev]/assets/<sha256>`, the same bytes as the store's `published.json`. The next release is diffed against it; a missing or stale store copy is replaced by it, checked by sha256. The launcher reads it apart from the rest of the feed (`RecordRef.FromFeed`), so a `baseline` of any other shape costs that one field and never the whole feed. |
| `releases` | array, newest first, at most 30, of `{ id, sha256, url, entries, lastPack, to? }` | Gone from the feed since #1050: the list is `releases.json` in the channel's store beside the feed (see "The feed store on the VPS"), written by `Publish-Update.ps1` on every release that names a `baseline` (the release list block, #442) and by `Rollback-Feed.ps1`, with `to` naming the release a rollback went back to. A feed that still carries the field (written before #1050, or by a Ship from a branch without it) is read too, merged by id, and the next write takes it out | No launcher. `Rollback-Feed.ps1`, `Scrub-Feed.ps1`, Ship's release tag check (`Get-StoreReleases`, `Release-Baseline.ps1`; `Read-ReleaseListFile`, `Release-Name.ps1`) | The record each release published, the same shape as `baseline`, plus `lastPack`, the last pack on the feed once that release was out, whose plugin list is the one it shipped ('' once the packs are gone: the record's own `:golden:` entries hold it). What a channel can be put back to; a release older than the newest thirty cannot be. The first release after #442 started the list with the `baseline` the feed already named. |
| `release` | object `{ id, channel, launcherVersion, packs, baseline, commit, branch, uncommitted, tag }` | `Publish-Update.ps1` on every release (the release record block, #444) | No launcher. Ship, which tags `commit` as `tag` once the feed is out (`Add-ReleaseTag`, `Release-Name.ps1`); the store's `releases.txt` | The release's one name is `id`, the id its packs and its `baseline` carry (`20260928-1630`, dev `20260928-2324-dev`). The rest is what else it is known by: the launcher the feed offers with it (the same across Ships that keep their launcher, #921), the packs it added, its baseline id (empty on a `-NoUpload` run), the commit it was built from and how many tracked files differed from it, and the tag `release/main/<id>` or `release/dev/<id>` (empty when it was not built from a git checkout). `Get-ReleaseDisagreements` says whether they agree, with each other and with `releases`, whose newest entry is the same id ending on its last pack. After a main Ship the dev feed carries main's, `channel` main. `Rollback-Feed.ps1` does not rewrite it yet, so after a rollback it still names the last Ship until the next. |
| `signedManifest` | object `{ url, sha256, catalogUrl, catalogSha256 }` | `Publish-Update.ps1` on every release that sends to the site (the signed manifest block, #2163 phase B); taken out by a `-NoUpload` run | No launcher yet (phase C of `docs\SIGNED-RELEASES.md`) | `release.json`, the sha256 of every asset of the release that carries code or names files (launcher, client runtime, packs, optional packs, the baseline record) with the commit it was built from, and a Windows catalog over it signed by ThornswoodRelease, both at `/feed[-dev]/assets/<sha256>`. Written only after the catalog was signed and passed the publish gate and `Signature.cs`; a signing failure stops the Ship before this file moves. Feed edits after a Ship carry it forward untouched. |
| `news` | array, newest first, at most 40 | `Publish-Update.ps1:Set-Prop $doc 'news' $news`; `Publish-Server.ps1:$newsList`. On the dev feed each entry's `channel` is `"dev"` while main has not had it, set by `Dev-News.ps1:Update-DevNewsChannels` | The site's News page, which reads it from the main feed (`site/lib/news.js` "news from the Release", #5187). Not the launcher since #5187: its News tab reads the build Releases its channel's Deployment reached (`launcher\app\ReleaseNews.cs`) | Cosmetic. Every launcher up to 1.2.3 reads the notes only here, so they stay here until the channel's minLauncher reads `newsFile` (#1050), and from then it is `[]`. Every script reads and writes the notes through `scripts\release\Feed-News.ps1` (`Get-FeedNewsList`, `Open-FeedNewsList`, `Set-FeedNewsList`), wherever the channel keeps them. |
| `newsFile` | object `{ url, sha256, count }` or absent | `Set-FeedNewsList` (`Feed-News.ps1`), called by Publish-Update (the news out block), Rollback-Feed, Publish-Server's news entry and a dev marks refresh (`Update-DevFeedMarks`), once the channel's minLauncher is at or above `$FeedNewsFileLauncher` (1.2.4, the first launcher with FeedNews.cs): every note, at most 40, as one asset at `/feed[-dev]/assets/<sha256>`, sent to the site before the feed names it. Absent before that. `Remirror-Site-Feed.ps1` checks it is on the site like any asset | The site's News page. Launchers from #1050 until #5187 read it (`FeedNews.cs`, gone); the launcher now reads the build Releases (`launcher\app\ReleaseNews.cs`) | Cosmetic. A file that cannot be had or read leaves the notes `news` carries and one line in launcher.log; the update check goes on. |
| `mainVersion` | string | `Dev-News.ps1:Set-DevFeedMarks`: the main feed's `launcherVersion`, read off the site, with the DEV marks, on every dev ship (one with nothing new included), after every main ship (`Refresh-DevNews.ps1`), and by `Refresh-DevNews.ps1` run by hand; `""` on a main ship (`Publish-Update.ps1:Set-Prop $doc 'mainVersion' ''`) | Dev News tab header (`ShellNews.cs:pendingDoc.mainVersion`) | Cosmetic. |
| `serverPassword` | string | Nobody. Every ship deletes it (`Publish-Update.ps1:$doc.PSObject.Properties.Remove('serverPassword')`) | No longer declared in `Config.cs:VersionDoc`; read by nothing since 1.0.197 | Must never come back: the feed is public. |

### A pack entry

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | `yyyyMMdd-HHmmss` (`yyyyMMdd-HHmm` before #1057), `-dev` added on the dev channel, never one the feed already names (`Release-Name.ps1:New-ReleaseId`). A release is one pack since #1053 (`Publish-Update.ps1:so a release is not split into parts`); an id ending `-<part>` is an older pack, split to stay under GitHub's 2 GiB asset limit. Compared case-insensitively with `applied.txt`. An empty id is never offered. |
| `url` | string | A thornswood.net host asset under `/feed/assets/<sha256>` or `/feed-dev/assets/<sha256>`, **or**, on a feed that still names `updateRepo`, a GitHub release asset in it (`Feed-Rules.ps1`). Since #897 a new pack is written as the site address. A GitHub one (a pack published before 28 Sep) is the browser download address, `https://github.com/<owner>/<name>/releases/download/<tag>/<file>`, since #445, or the older `api.github.com` asset id address; both stop answering when Thornswood-Releases is deleted (#907). Empty: the launcher skips it and writes it off as applied. A url that answers 404 fails the whole update and Play stays off. |
| `sha256` | string, 64 hex | Mandatory; checked after download (`Updater.cs:Download`). |
| `notes` | string | The whole Ship note, first line first. The update card shows it (`ShellUpdate.cs:pendingPacks[0].notes`). |
| `name`, `bytes` | string, number | Optional packs only: Add-ons on the Diagnostics page shows them (`Config.cs:Pack`). Publish-Pack also writes `notes` as a file count. |

There is no `size` or `files` field on a pack. The files a pack wrote are
recorded on each machine in `Profile\Packs\<id>.files`, not in the feed
(`Updater.cs:PackListFile`). A news entry's `files` was shown on the News tab
of the launchers before #5187; the launcher now reads its news from the build
Releases' notes (`ReleaseNews.cs:ReadReleaseNews`) and no feed news at all, and
no publisher fills it any more: `Publish-Update.ps1:$entry` has no `files`, and
`Publish-Server.ps1:$entry` writes it empty.

A pack is a zip with a `game/` tree (into the game folder), a `profile/` tree
(into `Profile\Default`, and a carried plugin list is put in place at once),
and an optional `delete.txt` of game paths to remove. Each tree is fenced to
its folder (`Updater.cs:Install`).

### A news entry

`date` (`M-d-yyyy h:mm tt`; older shapes are converted when read,
`Config.cs:NewsItem`), `title`, `body`, `details` (the note's `- ` lines, then
lines worked out from the diff), `channel` (`"dev"` or `""`). A Ship with the
same title and body as the newest entry adds nothing (`Publish-Update.ps1:same note as last time, so no new news entry`).

## How a launcher decides what is new

1. It reads the feed and saves the saved fields (`ShellUpdate.cs:OnVersionDoc`).
2. From #1050 on: when the feed names a `baseline` this install has not synced
   to (`Profile\release.txt`), that release is the one pending update, and no
   pack is replayed (`Updater.Pending`, `Sync.cs RecordDue`). See "Syncing to
   the release record". Otherwise, and in every launcher before #1050:
   pending packs are every `packs` entry whose `id` is not a line in
   `Profile\applied.txt`, in feed order (`Updater.cs:Applied`, `Updater.cs:Pending`). Order
   matters: part one before part two.
3. The launcher is not offered by the feed since #4825: it is offered when its
   Velopack channel on GitHub has a newer one (`VeloUpdate.cs:CheckLauncher`).
4. Packs go in first, one by one, each id appended to `applied.txt` once it is
   in (`Updater.cs:MarkApplied`). Then Velopack applies the launcher in a
   process of its own and keeps the version before in its packages folder,
   after every check in `VeloUpdate.cs:FetchLauncher`.
5. A fresh install gets an `applied.txt` listing every pack in the feed at
   build time, because the setup package already contains them
   (`Build-SetupFiles.ps1:applied.txt: every pack the channel's feed lists`).
   The dev build copies the main build's `applied.txt` when it is installed
   (`DevBuild.cs:Install`).

A machine that loses `applied.txt` asks for every pack on the feed again. A
launcher from #1050 on does not: it syncs to the record, which needs no
history.

## Syncing to the release record (#1050)

Patrick, 29 Sep: the launcher fetches each file straight from the site by its
fingerprint, syncing the install to the release record, instead of replaying
the chain of packs.

- **What the record is.** The `baseline` the feed names (#1011): one JSON
  object, itself an asset named by its sha256. Every key is a path under the
  game folder with the value `<bytes>:<sha256>` of a file of ours, plus:
  `:golden:plugins.txt` and `:golden:loadorder.txt` (the reference plugin list
  exactly as the pack carries it, into `Profile\Default`); `:gone:<path>` =
  `removed` for a file of ours a release stopped shipping, or `always` for
  Ship-Rules' delete list; and `:record:files` = `1`, written only once every
  file above is on the site beside the record. The `:profile:`, `:order:` and
  `:src:` keys are Publish-Update's own and no launcher reads them.
  `Release-Baseline.ps1` has the list.
- **What the launcher does** (`launcher\app\Sync.cs`). `Updater.Pending`
  offers one update standing for the release when the feed names a record this
  install has not synced to. Installing it reads the record (checked against
  its sha256), compares every file of ours in the install with it, by size and
  then sha256, and downloads only the ones that differ, from the folder the
  record is in: its own url with its sha256 swapped for the file's
  (`/feed[-dev]/assets/<sha256>`). The record's address is checked once
  (https, the host list, stored under its own sha256), so no file can come
  from anywhere else. Each download is checked against its sha256 (and size)
  before anything is written into the game; then they are put in place (a
  linked file is unshared first, as a pack does), the plugin list is settled,
  every `:gone:` path is taken out (a `removed` one is left alone when Vortex
  deploys that path now, the rule `RemovePack` keeps), the kept copies follow,
  every pack on the feed is marked applied, and `Profile\release.txt` records
  the release. A record without `:record:files` (every release before #1050)
  is written down as `packs <sha256>` and the packs go in as before.
- **Interrupted.** Downloads land in `Profile\Sync\<sha256>`: a cut off one is
  carried on from where it stopped with a Range request (thrown away and
  fetched whole once more if the joined file does not check out), a finished
  one is not fetched again, and a sync that stopped after its downloads
  finishes from them with the site out of reach. `release.txt` moves only once
  every step is done, and `Profile\Sync` is cleared then.
- **What it never touches.** The launcher exe: it updates only through
  `SelfUpdate`, with every check Signature.cs makes (WinVerifyTrust, the
  Artifact Signing root, the ThornswoodRelease durable identity,
  `ExpectedSigner`). The six client runtime files: they stay with the
  launcher, which puts back any that are not the build it records
  (`ClientRuntime.Heal`). Anything outside the game folder and
  `Profile\Default`.
- **A file changed by hand** is not a new release, so it is not offered on
  every check; the next release's sync, or `Updater.Resync`, finds it by its
  sha256 and puts only it right.
- **How every file gets on the site** (`Publish-Update.ps1`, the record files
  block). Before `version.json` is touched: the plugin list the pack carried
  goes in as `:golden:` (a release with no pack keeps the last one's); the
  `:gone:` list carries forward from the last record, adds what this release
  removed, and on the first record of a channel starts from every `delete.txt`
  the packs on the feed carry (read off each pack's zip directory with a Range
  request, not the whole pack); every file of ours is sent with
  `Remirror-Site-Feed.ps1 -Send`, which skips what is already up and sends the
  rest as one zip that the VPS unpacks, checking each file's bytes against its
  name; `-Have` then lists the folder and every sha256 the record names must be
  there, or the release stops with the feed untouched. The first record on a
  channel also runs Check-Secrets over the files no pack carries. Only then
  does the record get `:record:files`.
- **How big that is on the site.** Measured on the dev record of 29 Sep: 2,515
  files of ours, 463.5 MB, 449.0 MB once the files with the same bytes are
  counted once, stored as they are (not zipped). Each channel has its own
  folder, so the first release after this on each sends about that much; after
  that a release adds only the files it changed, the same bytes a pack carries
  unzipped. About 180 MB of that record is the Creation Kit and a backup of
  SkyrimSE.exe, which are not ours and should not be in a release at all
  (filed separately). Nothing deletes an old asset: a file every record in
  `releases` has stopped naming can be cleared by hand.

## When the packs can go

Updating is the one place backwards compatibility matters, so the packs stayed
on the feed, and Publish-Update kept appending them, for every launcher before
#1050. They go from a channel from the first Ship after both of these hold
(`Test-FeedPacksGone` and the packs gone block in `Publish-Update.ps1`):

1. the channel's `minLauncher`, as that Ship writes it, is at or above the
   first launcher that syncs to the record, the first one built from a commit
   with `launcher\app\Sync.cs` (854aeeed, 29 Sep). Read off the release tags on
   12 Oct: main 1.1.103 (`release/main/20261001-180012`), dev 1.1.102.8
   (`release/dev/20260929-1129-dev`; 1.1.102.7 the release before it had none).
   They are `$FeedFirstSyncLauncher` in `Release-Baseline.ps1`. Publish-Update
   sets `minLauncher` to the feed's `launcherVersion` on every publish (#937);
2. the last record the feed named already carried `:record:files`, so its
   `:gone:` list was started from the packs (that Ship printed "read what N
   pack(s) took out") and carries forward what they took out.

Both held on 12 Oct: main and dev were on minLauncher 1.2.3, and both records
(main 20261011-175014, dev 20261011-221215-dev) carry `:record:files` with 342
and 344 `:gone:` entries. So the first Ship on each channel after #1050's
change takes the packs off.

An installed launcher of any age still updates: one before 1.1.103 (or dev
1.1.102.8) finds no pack, is offered the launcher, takes it through the signed
self-update (unchanged), and the new launcher syncs the install to the record,
taking out every file of ours a release removed since, from `:gone:`. Nothing
an old launcher needs in order to update comes from `packs`. A launcher from
1.1.103 on already took no pack: it syncs to the record and marks the packs
applied unread.

What changes: `packs` is `[]` rather than left out, the shape every launcher
ever published has read; a release adds no pack (it still builds the zip,
which Check-Secrets reads, and keeps it in the staging folder unsent);
`release.packs` is empty and the store's list names no `lastPack`; the
record's pointer carries the note (`baseline.notes`), which the update card of
a launcher from #1050 on shows; and `Rollback-Feed.ps1` builds no pack,
because a record whose files are up is the whole rollback, refusing one whose
files are not all on the site. A launcher from before the note moved (1.2.3
and older) shows "Update available, 1 mod update" without the note's text on
its card; the note is on its News tab as before. After it, version.json is:

```json
{
  "launcherVersion": "1.1.103", "minLauncher": "1.1.103",
  "launcherUrl": "https://thornswood.net/feed/assets/<sha256>", "launcherSha256": "<sha256>",
  "launcherInputs": "<sha256>",
  "serverAddress": "play.thornswood.net", "serverPort": "7777", "voicePort": "7778",
  "voiceUrl": "https://thornswood.net/voice", "updateFeedUrl": "https://thornswood.net/feed/version.json",
  "collectionUrl": "...", "collectionRevision": 1, "maxOnline": 25,
  "discordAppId": "...", "siteUrl": "https://thornswood.net", "presenceImage": "...",
  "expectedExeBytes": "...", "newerExeBytes": "...", "depots": [ ... ],
  "clientRuntime": { "url": "...", "sha256": "...", "bytes": 6356315, "forkCommit": "..." },
  "packs": [],
  "baseline": { "id": "20261001-1200", "sha256": "<sha256>", "url": "https://thornswood.net/feed/assets/<sha256>", "entries": 2583, "notes": "<the release note's title>" },
  "release": { ... }, "news": [ ... ]
}
```

Measured on the live feeds on 12 Oct (read over https): main 95,085 bytes, of
which `packs` (82) is 47,950, `news` (40) 31,282, `releases` (6) 1,513 and
`release` 2,826; dev 111,305 bytes, of which `packs` (116) is 66,018, `news`
(40) 19,980, `releases` (30) 7,921 and `release` 2,840. Taking out `packs` and
`releases` leaves about 45.6 KB on main and 37.4 KB on dev, most of it the
news. Every launcher up to 1.2.3 reads the news only out of version.json, so
the notes leave it only from the first Ship whose minLauncher reads the news
file (1.2.4, `launcher\app\FeedNews.cs`): from then they are one asset named as
`newsFile` and `news` is `[]` (`scripts\release\Feed-News.ps1`). Projected on
the 12 Oct feeds as pwsh 7 writes them, that is about 6,600 bytes on main and
5,850 on dev. Measured after main's 1.2.4 Ship (20261012-115531) and dev's
20261012-142406-dev, both with `news: []` and a `newsFile` whose bytes hash to
its name: main 7,789 bytes, dev 5,726.

Two more things then left the file (#1050). The release record no longer
carries `uiAssets`, the front's hashed file names (2,569 bytes, read by no
launcher, script or page): they are `Data\Platform\UI\thornswood-ui-assets.txt`,
a file of the release that its record already holds by sha256. And every
writer writes version.json compact, with no indentation or line breaks,
through one function, `Write-FeedVersionFile` in `Feed-Json.ps1`
(`tests\test-1050-feed-compact.ps1`). Both are JSON every launcher ever
published reads the same way. On the same two feeds that is 4,250 bytes on
main and 2,187 on dev. Of main's, 2,277 is the release note in
`baseline.notes`, which the update card of a launcher from 1.2.4 on reads; the
rest, about 1,950 bytes, is the fields above, each one read by a launcher or a
script.

Measured on 19 Oct over https: main 4,928 bytes (release 20261017-205912), of
which 2,956 were the whole release note in `baseline.notes`; dev 3,015 (release
20261019-211906-dev), 584 of them the note. The card showed every line of it,
29 on main, wrapped above Play. So `baseline.notes` is the note's title alone
(`Release-Baseline.ps1:New-FeedBaselinePointer`), which every launcher from
1.2.4 on shows the same way, and the whole note stays on the News tab as the
newest entry of `newsFile`. That takes main to about 2,040 bytes and dev to
about 2,480 (dev also names its `signedManifest`, 391 bytes).

## version.json in two (#1050)

Patrick's answer of 19 Oct: version.json carries only what the update check
needs, names the rest of the feed as one more asset, and names every asset by
its sha256 alone. A launcher reads the feed on every check, every thirty
seconds in a session, and almost none of it moves between releases.

The store is unchanged: every generation on the VPS is the whole feed, and
every script, backup and page reads it whole. The split is what the site
answers (`site\lib\feed.js` `feedView`), once the feed's `minLauncher` is at or
above `FEED_SPLIT_LAUNCHER`, 1.2.6, the first launcher that reads it
(`launcher\app\FeedSettings.cs`). Below that the generation is answered byte
for byte, as before.

- **version.json** holds `launcherVersion`, `minLauncher`, `launcherUrl`,
  `launcherSha256`, `baseline`, `newsFile`, `packs` and `news` (the last two
  the empty lists every launcher has read), and `settings: { sha256 }`.
  `launcherUrl` keeps its address, because a launcher below minLauncher needs
  it to update itself; `baseline` and `newsFile` carry no `url`.
- **The settings** are every other field, as one line of JSON, answered at
  `/feed[-dev]/assets/<sha256>` by the site from the generation itself, never
  a file in the assets folder, so a Scrub or a restore cannot lose them.
  `clientRuntime` and `signedManifest` in them carry no `url` or `catalogUrl`.
  The last four generations' settings stay answerable, for a launcher that
  read version.json just before a Ship.
- **Every asset's address** is the feed's own folder plus `assets/` plus its
  sha256 (`Updater.AssetsOf`, `RecordRef.AssetUrl`), which is where
  Publish-Update has always put every asset.
- **The launcher** (`Updater.ReadFeed`) joins the two into one `VersionDoc`
  (`VersionDoc.Join`), so nothing that reads it knows which file a field came
  from. The settings are fetched only when their sha256 is not the one in
  memory or in `Profile\feed-settings.json`, checked against it, and kept
  there. Settings that cannot be had or do not hash are a feed it cannot
  read, and the check fails with the reason.
- **The ETag** is the generation's size and time as before, with `-split` on
  a split one, and `/watch` hands out the same tag.
- **A script that reads the site's feed** over https, not the store, reads it
  through `Join-FeedSettings` (`Feed-Json.ps1`): `Read-SiteFeed`,
  `Check-Outside.ps1`, `Setup-ShipMachine.ps1` and
  `Copy-ReleaseAssets-ToSite.ps1`. The rest read the launcher fields alone.

Projected from the 19 Oct main feed with the note's title, version.json is
about 650 bytes. `launcher\tests\test-1050-feed-split.js` holds the site to this, and
`launcher\tests\test-1050-feed-split.ps1` the launcher, `Join-FeedSettings`, and (with
`-OldSrc`) every older launcher reading the split version.json as a feed that
is behind and offers only the launcher update.

It reaches launchers with the site deployed and the first launcher at 1.2.6
or above on a channel: Publish-Update writes minLauncher as the launcher it
publishes, so that Ship is the one the site starts splitting on. Bump-Version
moved main's number to 1.2.6, and dev's numbers climb from main's, so dev
split from its first 1.2.6.N and main from its 1.2.6 Ship. Since 1 Nov 2026
the number comes from the build (`LauncherVersion.ps1`, #5179), 2026.1101.1745
and the like, above every 1.2 number. A launcher at 1.2.6
reads a feed that is not split the same as before, so the site can go first.

## Checks on every download

- **Host allow list.** https only, and the host must be `github.com`,
  `objects.githubusercontent.com`, `release-assets.githubusercontent.com`,
  `api.github.com` or `thornswood.net`, or under one of them
  (`Updater.cs:AllowedHosts`). The update token, if any, goes only to
  `api.github.com` (`Updater.cs:FeedAsk`).
- **sha256.** Required for packs and the client runtime; an empty one refuses
  the download (`Updater.cs:Download`). The launcher's Velopack package is
  held to its channel's feed and to the Release's signed record
  (`VeloUpdate.cs:FetchLauncher`).
- **Signature.** Every program in a downloaded launcher package, and
  Velopack's Update.exe, must carry a signer whose Subject contains
  `ExpectedSigner`, the name on the signing certificate (the profile is
  ThornswoodRelease), checked before anything is replaced
  (`VeloUpdate.cs:FetchLauncher`). Before #4825 the launcher's own swap
  checked its new exe the same way, in every launcher from dev 1.1.101.17 on. Main's live
  1.1.101 predates it and is itself unsigned; dev 1.1.101.34 is signed and
  timestamped. Up to #912 the check read only the embedded certificate's
  Subject, so a self-made certificate with that name passed. Since #912
  (`launcher\app\Signature.cs`) Windows verifies the signature and its chain
  first (WinVerifyTrust: a changed or self-signed file fails), and the chain
  must end at Microsoft Identity Verification Root Certificate Authority 2020,
  come from a "Microsoft ID Verified CS" authority, be timestamped, and carry
  Thornswood's Artifact Signing durable identity value
  (`1.3.6.1.4.1.311.97.203948530.216998690.847558466.123546472`), which stays
  the same across the three day certificate renewals. Launchers already
  installed still run the old Subject check, which a real signed launcher
  passes.
  Packs and the client runtime are zips and are not signed: the host and the
  sha256 are their only checks.
- **Quota.** Nothing a launcher fetches spends the sixty anonymous
  `api.github.com` requests an hour any more (#445): the feed is on
  thornswood.net, and since #897 so is every new download. The GitHub urls
  still on a feed are browser download addresses (redirected to the asset
  CDN, no quota) or older `api.github.com` asset id addresses; the next Ship on
  each channel, or `Repair-Manifest.ps1 -MoveToSite`, moves them all to the
  site.
- **Publish side.** `Feed-Rules.ps1` refuses a new pack whose url is not a
  thornswood.net feed asset under `/feed/assets/<sha256>` or
  `/feed-dev/assets/<sha256>`; a GitHub release asset passes only on a feed
  that still names that repository as `updateRepo`, and since #907 a publish
  takes `updateRepo` out. Since #897 every new pack, launcher and client
  runtime is sent to the site and named there. `Check-Secrets.ps1` scans every zip
  and exe before upload. Nothing is written to the feed if any asset failed to
  upload, and `version.json` is written without a byte order mark.
- **Signing.** On since 27 Sep: `Ship.ps1` refuses a launcher that is not
  Authenticode Valid under `ExpectedSigner` (Developer-Guide.md,
  `records\signing\README.md`), or that the launcher's own `Signature.cs`
  check refuses (#912). The setup program is Velopack's since #4824, signed
  by `merge-release.yml` with the launcher's package inside it.
- **Optional packs go to the site too.** `Publish-Pack.ps1` sends each zip to
  `/feed/assets/<sha256>` with `Remirror-Site-Feed.ps1 -Send` before
  `version.json` is touched, names it there, and sends the feed to the VPS
  store with `Remirror-Site-Feed.ps1`. The GitHub release path went with
  Thornswood-Releases (#907). It publishes nothing today
  (`optional-packs.txt` lists none).

## Main and dev

- **main** is written by a main Ship from Patrick's machine, or by a hotfix
  Ship. It is also what `Set-Server.ps1`, `Set-Collection.ps1` and
  `Publish-Pack.ps1` edit.
- **dev** is written by `Ship.ps1 -Channel dev` from any branch on any
  developer's machine; the last dev Ship wins. No Ship of either channel
  carries a launcher since #4825: the launcher's number is its Velopack
  version, `<yyyy>.<M*100+d>.<n>`, given by the build Release it goes out on
  (`MergeRelease.ps1`, New-MergeReleaseNames).
- **After a main Ship**, the Dev feed, baseline, release identity and history
  stay unchanged. Dev advances through its own Ship and keeps its own server
  and voice addresses. Publish the same source to both channels when both
  should carry it; their release records remain independent.
- **Before editing**, every script that edits a feed receives it from the VPS
  store, and each send replaces it there only if it has not changed since
  (`Feed-Store.ps1`, #907). A refused send leaves the release marked NOT
  SHIPPED and resumable.
- **Each release has one name and a tag** (#444): its id, recorded in the
  feed's `release` with everything else it is known by, and in the store's
  `releases.txt`. Once the publisher has sent the feed, Ship tags the commit it
  was built from `release/main/<id>` or `release/dev/<id>` (annotated with the
  launcher, packs, baseline and feed) and pushes the tag; never on a dry run,
  and a tag that did not go on is a line on Ship's last screen with the command
  that finishes it. `git tag -l 'release/dev/*'` lists dev's, `git show
  release/main/<id>` says what one shipped. The `v<version>` tags are not
  these: a person pushes one so CI builds a main launcher (`release.yml`).

## Putting a channel back (#442)

A launcher never takes a pack back off: a required pack id stays in
`applied.txt`, and `IsNewer` only goes up (`Updater.cs`). Until #442 the only
way back from a bad release was to ship another one by hand with a higher
launcher version and a pack that put the files back, which is what 1.1.77 did
for 1.1.76 on 21 September.

Now it is one command, and it goes the same way as every other update:

```
.\scripts\release\Rollback-Feed.ps1 -Channel dev -List      what the feed can go back to
.\scripts\release\Rollback-Feed.ps1 -Channel dev -Back 1    back to the release before this one
.\scripts\release\Rollback-Feed.ps1 -Channel dev -To <id>   back, or forward again, to that one
```

- **What it builds.** The records of two releases (`baseline` now and the one
  asked for in `releases`) are compared file by file, and the difference goes
  out as ONE ordinary pack on the end of `packs`: every file whose bytes differ
  at the older release's bytes, every file added since in `delete.txt`, and
  the plugin list out of the pack that release ended on (`lastPack`). The
  feed's `baseline` then names the record of what that pack leaves installed,
  sent to the site like any other, and the store's `published.json` is the
  same bytes, so the next Ship is diffed against the rolled back state.
- **Why every installed launcher follows.** Nothing in the launcher changed:
  the rollback is a pack like any other, at `/feed[-dev]/assets/<sha256>`,
  with its sha256 on the feed. A launcher that took every release applies it
  and lands on the older files; one several releases behind applies those and
  then this, and lands on the same files; a fresh install seeded with every
  pack id applies only this. `tests\test-feed-rollback.ps1` proves all three
  with the launcher's own `Updater` compiled, back, further back and forward.
- **Launchers that sync to the record** (#1050) follow the new record rather
  than the pack: it names what the release asked for installed, lists what the
  later releases added under `:gone:`, and says `:record:files` once every file
  it names is in the channel's folder on the site (the rollback sends any that
  are not, from what it staged or from the folder of either record). When one
  cannot be had it goes out without `:record:files` and those launchers take
  the pack like the rest. `tests\test-record-sync.ps1` proves both kinds land
  on the same files, back and forward.
- **Once the packs are gone** (the feed's `minLauncher` syncs to the record,
  "When the packs can go"), a rollback is the record alone: no pack goes on
  the feed, the plugin list is the `:golden:` entries of the record it goes
  back to, and the list in the store names no `lastPack`. A record whose files
  cannot all be had is refused with nothing sent, because no launcher would
  have anything to take. The zip is still built from what was staged, for
  Check-Secrets, and not sent. `tests\test-record-sync.ps1` goes back and
  forward that way too.
- **Where the list is.** `releases.json` in the channel's store beside the
  feed since #1050 (it was `releases` in version.json), received and sent
  with the feed in one step.
- **Where the bytes come from.** The site's copy of each file beside its record
  (#1050), then the packs already on the site, found by size and sha256 and
  checked again as they are read. A file only the installer ever carried is
  restored from `/feed[-dev]/assets/<sha256>` the same way, so a rollback past
  the release that first changed it needs no `-FilesFrom` (#1051). When that
  asset is missing (a record from before #1050, or one scrubbed off the site),
  the rollback stops, names the file, and sends nothing; `-FilesFrom <folder>`
  points at a folder holding such files at their game paths, and only a file
  of the right size and sha256 is taken.
- **What does not go back.** The launcher, `launcherVersion`, `minLauncher`
  and `clientRuntime`, and the six client runtime files: a launcher never
  moves to a lower number, signed launchers refuse an update not signed by us,
  the site refuses a join pass above `launcherVersion`, and the launcher
  carries the record of which client belongs beside it and puts back any
  other. A bad launcher is fixed forward by a Ship. The server is not in the
  feed either: if the release being undone changed the gamemode or the
  plugins the server loads, the server goes back too. And if that release
  changed how the launcher and the game's own plugins talk to each other,
  putting the files back without the launcher is not enough; ship a fix
  instead.
- **How far back.** To any release in the store's list, which starts with the first
  Ship after #442 on each channel and holds the newest thirty. A release that
  named no record (every one before #441, and a `-NoUpload` run) is not one.
- **Safety.** `-DryRun` builds the pack and sends nothing. The pack is checked
  by `Check-Secrets.ps1` like a Ship's, the note by `Note-Rules.ps1`, and the
  pack and its record are on the site before `version.json` names them. The
  feed and the baseline go back through `Feed-Store.ps1` in one send, which
  replaces nothing if another Ship or feed edit went out meanwhile.

Optional packs are the one thing a person can remove themselves
(`Updater.RemovePack`).

## What looks wrong in the feeds today

Re-checked on 28 Sep against both live feeds on thornswood.net and the records
in this repository (#897). The three problems this section once listed (dead
private packs, main and dev launcher versions apart, `Updater.cs` behind the
feed) are still cleared: main holds 75 packs and dev 92, none under the private
source repository; main's `launcherVersion` is `1.1.101`, the same as `Version`
in `Updater.cs` and as the dev feed's `mainVersion`; dev is on `1.1.101.34`.
Both feeds carry `collectionUrl` ending `7essxf` and `collectionRevision` 1.
The stale-main-clone hazard in `Publish-Update.ps1` is gone with the clones
(#907): a dev publish reads main's feed from the site every time.

What differs, none of it broken:

- **Download urls on GitHub**, on 28 Sep every one (main 77, dev 94), though
  the site holds every one; each channel's next Ship moves them (see
  "Downloads come from the site"). Thornswood-Releases is deleted only once
  neither feed names one (#907).
- **Both feeds' client runtime is behind the record.** Main names fork
  commit `a922b480` and dev `10841f40` (read 29 Sep); `records\client-build.json`
  is on `1a2e5995` since #1200 (the pin and both build records one commit, a
  refused craft put right at once), on top of `b4543a86` from #898, which lets
  the game hear the key up of a key
  it holds while a panel has the keyboard, on top of `10841f40` (#1016, J
  kept from the game's journal) and `267ac311` (#919, no mDNS responder in
  the game's browser). The next dev Ship carries it.
- **Main has no Skyrim pin fields.** The dev feed's `expectedExeBytes`,
  `newerExeBytes` and `depots` match `records\skyrim-pin.json`; main was last
  published before #874 added them, so main launchers use their compiled
  values until the next main Ship.
- **Main's live launcher is unsigned** (1.1.101 predates signing); the next
  main Ship is the first signed one. See "Checks on every download" for what
  the signer check does and does not prove (#912).
