# Privacy

What Thornswood keeps about you, why, and how to have it deleted.

Last changed: 1 November 2026.

Thornswood is a free fan project run by a small team in their own time. It is
not a company. This page is written plainly rather than legally, and it is
meant to be the whole truth rather than the minimum.

The operators are primarily based in Colorado, United States. Thornswood is
aimed at adults in North and South America. Privacy questions and requests
go through the [Discord](https://discord.gg/vAkpbWyfFP), including its private
support tickets.

## The short version

- Signing in with Discord tells us your Discord id, your name there and which
  roles you have. Nothing else from your Discord account.
- Playing sends the server your character, where it is and what it does, and
  what you type in chat.
- Voice goes straight from one launcher to another and is not recorded, so the
  people in a voice room see each other's internet address (below).
- Ask for deletion in the Discord and it is done.
- There is no advertising tag on this site. Cloudflare counts how often each
  page is opened and how fast it loads, with no cookie (below).

## What is stored, and why

**Your Discord id, name and roles.** Sign-in is Discord and nothing else, so
this is how the server knows who you are and whether you are allowed in. It is
the only identity Thornswood has: there are no passwords here and no email
addresses.

**Your application.** Applying in the Discord keeps what you wrote in a
private ticket only you and staff can read, and on the site for staff. Your
answer to whether you accept the rules is also kept on the site against your
Discord id, with the time you gave it, so there is a record that you agreed to
them.

**When you played.** Each session records who, when it started and when it
ended, so an alpha has a record of what was tested and by whom instead of
somebody's memory. The game server's door also writes down each time a
character connects, by its profile and character numbers, and whether it
was let in, so staff can see why somebody could not get in.

**Your character.** Name, appearance, what you carry, where you are standing,
what you have built and claimed, and the ranks you have earned. That is the
character, and without it there is nothing to log back into.

**What you say in chat.** Kept so that a report of something that happened has
something behind it other than one person's word. If you would not want staff
to read it, do not type it.

**Reports and calls for help.** /helpme and /report in the game, and a report
about a person on the site's report page, keep who sent it, who it is about,
what they wrote and where they were standing, so staff can act on it. Only
staff read them, the person reported is not told, and nothing else from
the chat is copied into them.

**Using /stuck.** Each use keeps your character, your profile, your Discord
account, where you were and where it sent you, and when, so staff can see it
was used for being stuck. The game server also keeps the last few places each
character stood, for as long as they are online, so /stuck has somewhere to
send them back to; that list is gone when they leave or the server restarts.
Only staff read these.

**Staff records.** When staff ban a character or a whole account, kill a
character for good, or write a note about somebody, the site keeps it against
the Discord account or the character, with who did it, when and why, and the
staff channel is told. A character killed for good is kept, not deleted. Only
staff read these: somebody who is not staff never sees a note, even one
about them.

**Your join number.** When you join the Discord, the bot writes down which
arrival you were against your Discord id, so the number on the welcome card
is never handed to two people, and is yours again if you leave and come
back.

**The logs sent when a session ends.** Every time the game closes, the
launcher sends the site the last part of each of these files from your PC
(or at its next start, if the site could not be reached). They are how
somebody who cannot play gets helped without a conversation, and what a
report or a ban about that session rests on:

- **launcher.log**, the launcher's own log: what it checked, fixed,
  downloaded and started, what failed, which version you are on and how long
  the launcher took to open. It also names the voice server's address and
  port, the profile number voice used and your microphone's name as Windows
  gives it. It runs on from one session to the next, so its last part can
  reach back into earlier ones. If Steam's window would not come to the front
  while the launcher was setting up the game, it names the program that was
  in front instead, by its name only and never what it showed. A copy stays
  on your PC as well (below).
- **crash.log**, only when the game crashed in that session: Crash Logger's
  report of it, which can name your Windows version, processor, graphics card
  and memory, what the game was doing when it went down and the mods it had
  loaded. The full crash snapshot beside it stays on your PC.
- **thornswood-front.log**, the game's menus and panels: your profile and
  character names, the server it connected to, the names of things you
  looked at or used, what you pressed in its panels, any error, and lines
  other people said near you in chat.
- **thornswood-voice.log**, voice: the names of the sound input devices on
  your PC and which one voice used, the folder the game is in, the server,
  and the names of the other people in your voice room with whether each was
  connected.
- **thornswood-emotes.log**, the emotes and quick slots you used.
- **thornswood-input.log**, the game's keyboard and mouse: how many keys it
  read (never which ones), the names of the input devices, whether the
  game's window had the keyboard and, when another window had it, that
  window's kind and process number.
- **thornswood-loadorder.txt** and **thornswood-plugins-light.txt**: the name
  of every plugin the game loaded, including any you added yourself.
- **skyrim-platform.log**, Skyrim Platform's own log: a second copy of the
  game's lines above, every message passed between the game and its pages,
  the server it connected to, and Skyrim Platform's own lines about the
  game's scripts and its browser.

With them go the launcher's own check of your game files at that moment
(which plugins are missing or not the server's, with the size and checksum
the server expects) and any part of the Play page that was not ready.

Before any of it leaves your PC the launcher takes out anything shaped like a
voice join token, a sign-in ticket or a join pass, and puts a placeholder in
place of your Windows user folder, any other account's folder under Users,
your Windows account name where it is a folder, and your PC's name. The site
keeps the last 256 KB of each file and at most 1 MB a session. When a log
shows that the game crashed or threw an error, the line that shows it, up to
300 characters, is copied onto the session's record and posted in the staff
channel in the Discord, so staff hear about it without opening the logs.
That post stays in the channel.

**Gallery submissions.** The picture or recording, your signed-in account,
the name for its caption and any note for staff are kept for review. A
picture or recording can also say inside the file where it was taken (a
phone or camera often writes the GPS position), when, and with which camera
or program. The site takes all of that out as the file arrives, so none of
it is kept or shown. Of the file, only the picture or recording itself is
kept, with its colours and which way up it is shown. Only approved
submissions appear publicly. Their caption and media then become public too.
With a picture, your browser or the launcher also sends smaller copies of
it, which are shown in its place on smaller screens and deleted with it.
Submit only material you have permission to share, without private
information about other people. Ask in the Discord to have a submission
removed. Removing one deletes its file from the site. See [Terms](/terms)
for publication permissions.

## What is not stored

- No email address, no password, no payment details. Patreon holds the
  payment side and Thornswood never sees a card.
- No voice recording. Voice is passed between the people in the room and
  nothing keeps a copy.
- No advertising tag on this site. There was a Google Ads tag until 23
  September 2026 and it was removed.
- No cookie or anything else kept on your machine for counting visits.
  Cloudflare's page counts, below, need none.

## What leaves this site anyway

Honesty about the things a page does by existing:

- **Voice** connects each launcher in a voice room straight to every other one
  in it, machine to machine, with nothing in between. To make that connection
  each launcher hands the others its internet address, the public one and the
  one on your own network, so everybody with voice on in that room can read
  yours from their own launcher. The voice service only introduces them, and
  keeps no copy of what is said.

- **Discord** is where sign-in happens, so signing in tells Discord that you
  signed in here.
- **Launcher updates and the installer** are asked for at Thornswood's own
  site. Since the code went public on 30 October 2026, every file of a
  release is also published on GitHub, where Thornswood's code is kept, and
  the site sends the launcher (or your browser, for the installer) on to
  fetch the file from there once GitHub holds the same file. GitHub then sees
  your address and which file was fetched, and keeps its own records under
  [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
  The file is the same either way: the launcher checks each one against the
  sha256 the site's update list names before using it. When GitHub does not
  hold a file, the site sends it itself.
- **Cloudflare** carries every connection to this site, and to voice, on
  its way to our server, which answers nobody else. Like any network
  between you and us it sees your address and what you ask for, and it
  keeps its own records under
  [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).
- **Cloudflare Web Analytics.** Since 22 October 2026 Cloudflare adds one
  small script to each page on its way to you, from
  static.cloudflareinsights.com. It reports that the page was opened, which
  page, the page that sent you there, the kind of browser and device, and
  how long the page took to load. It sets no cookie and keeps nothing on
  your machine, and Cloudflare does not use it to follow anybody from site
  to site. Thornswood sees only totals: how many visits each page had, from
  which countries, and how fast it loaded. Blocking cloudflareinsights.com
  in your browser stops it and changes nothing else on the site.
- **Cloudflare Turnstile**, on the report page only, since October 2026.
  It is the check under the form that a person, not a script, is sending
  the report. It loads from challenges.cloudflare.com when the report page
  opens and looks at the browser, not at anything typed into the form.
  When the report is sent, this site asks Cloudflare whether the check
  passed, with your address, and keeps only the report. What Cloudflare
  does with what it sees is in the
  [Turnstile privacy addendum](https://www.cloudflare.com/turnstile-privacy-policy/).
  Blocking challenges.cloudflare.com stops the report form from sending;
  /report in the game and a ticket in the Discord still reach staff.

Apart from Cloudflare's analytics script and Turnstile, opening a page on this
site loads nothing from anybody else. The fonts came from Google and a markdown renderer from cdnjs
until 24 September 2026, and both are served from here now.

## How long it is kept

- **Sign-in records**, the only thing on the site holding your address, are
  deleted after 30 days. The address is the one your connection reached the
  site from, as our own front door saw it, not anything your browser claims
  about itself. Cloudflare carries the connection the last step, and the
  front door takes the address from Cloudflare only when the connection
  really comes from Cloudflare. That is enforced by the site rather than
  promised: old rows go whenever the log is written or read.

- **The game server's log** records the address each connection to the game
  came from, beside the Discord account it signed in as. It keeps nothing
  older than 30 days: the server checks every hour and deletes each line as
  it passes 30 days. Staff read it to look into a fault or a report.
- **The site's, voice's, gamemode's and bot's own logs** (site.log, voice.log,
  thornswood.log and bot.log) record what each service did, with profile
  numbers, character names and some Discord ids, never an address. Nothing in
  them is kept past 90 days.
- **Session records and chat** are kept for 365 days, then dropped. That is
  the record of each session and the logs sent with it. The site checks
  every hour, so nothing waits for somebody to play first. A session staff
  mark as kept, because a report or a ban rests on it, is not dropped, and
  neither are its logs, for as long as staff keep it marked; once they let
  it go, it goes with the rest at 365 days. Chat on the voice service ages
  the same way. Both numbers come from the code rather than a promise on this page; if
  they change, this line changes with them.

- **Your character** is kept until you ask for it to be deleted, or until a
  wipe, which is announced first. A wipe, a character reset or putting a
  backup back leaves the characters it replaced set aside on the server for
  30 days, so it can be undone, and then deleted. The server checks every
  hour.
- **The logs sent when a session ends**, every file named above and the
  launcher's check that goes with them, are kept for 365 days, like session
  records, unless staff mark the session kept. So is the line copied from
  them onto the session's record.
  Of launcher.log, the copy on your PC keeps each line for 30 days (below).
- **A gallery submission that is removed** has its file deleted then. One
  taken down after somebody reported it is kept out of sight for 30 days, so
  staff can look into the report, then deleted. The site checks every hour.
- **A gallery submission waiting for staff** waits for 90 days at most. One
  staff have neither accepted nor deleted by then is taken off the queue and
  its file deleted. An accepted one stays up until it is removed.

- **Your application** on the site is kept for 365 days, like a report, then
  dropped. The ticket itself is a private thread in the Discord. Staff close
  it rather than delete it, because it is the record of what you were told,
  and it stays in the Discord, closed, for 365 days, then the bot deletes it.
  A ticket nobody closes is closed by Discord after a week with nothing said
  in it, and goes 365 days after that. Opening a ticket again starts its 365
  days over when it next closes. Each time a ticket is closed, the bot writes
  a line in a staff only ticket log naming the ticket, which carries your
  name in Discord, and a ticket whose private thread cannot be opened goes
  into that log whole instead. Each of those goes 365 days after it was
  written. The bot checks every hour.
- **Your answer to the rules** is kept for as long as your account is here,
  because it is the record that you agreed to them, and goes with the rest
  of your account when you ask for that to be deleted.
- **Reports and calls for help** (/helpme, /report, the report page and a
  report about a gallery picture) are kept for 365 days, like the chat they
  are about, then dropped. The site checks every hour.
- **/stuck and the staff logs.** Each use of /stuck, each thing staff did in
  the world or on the site, and each move out of the world for being idle is
  one line in a staff log, and each line is kept for 365 days, then dropped.
  The site and each game server check every hour.
- **Staff records.** A ban is kept for as long as it holds. Lifting one
  deletes it, and one that ran out is kept for 365 days after it ended, then
  deleted. A character killed for good stays dead, so that record is kept;
  one an admin undid is kept for 365 days after it was undone, then deleted.
  A staff note is kept for 365 days from when it was written. The site
  checks every hour.
- **The game server's door log** keeps each line, a character connecting
  and whether it was let in, for 90 days, the same as the gamemode's own
  log. The game server checks every hour.
- **Your join number** is kept while you are in the Discord, and for 365
  days after you leave, so coming back within a year keeps it. Then it is
  dropped. The bot checks every hour.

**Backups.** Encrypted recovery copies include site records and uploads. The
server keeps seven daily and four weekly copies. Copies sent off the server,
to the operator's own cloud server and from there to the operator's Google
Drive, still encrypted, are kept for 30 days in each place, with at least
seven retained for recovery. A whole copy of the server taken by hand, before moving it to a
new machine, is encrypted the same way and kept on the operator's computer
for 30 days. These are private recovery copies, not public downloads. Removing
a live record does not rewrite older backups; they expire through that
retention schedule. The game server's log is not in them. Staff must
reapply completed deletion requests before putting an older backup back
into service. What putting a backup back replaces (the site's records and
uploads, the bot's join numbers, characters) is set aside on the server for
30 days, so it can be undone, and then deleted.

## What the launcher keeps on your PC

The launcher keeps these in the Profile folder of the folder it is installed
in (C:\Thornswood\Profile, unless you installed it somewhere else). None of
it leaves your PC except as this page says above.

- **Its log**, launcher.log, the one described above. Each line is kept for
  30 days, then removed: the launcher cuts the log every time it starts.
- **Support reports**, the zips Build the report on Diagnostics makes for a
  ticket in the Discord. Each holds a copy of the log and a short summary of
  your machine. Nothing sends them; only you do, by posting one. Each is kept
  for 30 days, then deleted the next time the launcher starts.
- **Your Discord sign-in**, so you are not asked to sign in every time. The
  sign-in itself is locked so only your Windows account can read it, and your
  Discord name and picture are kept beside it in plain files, for the Discord
  card at the top of the launcher. They are kept until you uninstall.
- **Your characters, saves and settings**, and the launcher's record of what
  it installed, kept until you uninstall.

**Uninstalling** from the launcher's Settings page removes all of it. With
"Keep this build's saves and settings" ticked, as it is unless you untick it,
only your characters, saves and settings and the launcher's record of what it
installed stay. The log, the Discord sign-in, name and picture, the support
reports and the browser data go either way, and if one of them cannot be
removed, the launcher's last message names it so you can delete it yourself.
Deleting the install folder yourself removes everything as well.

## Deleting it

Ask in the Discord, or open a ticket there with **I need help**. Say which
account and what you want removed. It is done by a person, and you will be told
when it is. Each part of Thornswood (the site, the game servers, voice chat and
the Discord bot) removes it from its own records the next time that part
restarts, which happens with its updates: usually within a day, and for voice
and the bot sometimes up to a week. You are told once every part has done it.

You can also ask what is kept about your account, request a copy, or ask to
correct it. Use a private ticket for account details rather than a public
Discord message. Do not send a government identity document.

A request covers what Thornswood keeps, not your PC: what the launcher keeps
there is yours, and uninstalling removes it (above).

What deletion means here: your Discord link, your session records and the
logs your launcher sent with them, your chat, your character, your answer to the rules, the applications and calls for
help you sent through the site, your gallery pictures and your join number.
A ticket in the Discord, and the bot's lines about it in the staff ticket
log, are not deleted by a request: each stays until its 365 days above are
up, because it is the record of what you were told. What cannot be undone is something you said that somebody
else has already quoted in a report, because that now belongs to the report.
Staff's own records stay for the same reason: a ban, a note, a character
killed for good, a report you made or one made about you, a line in a staff
log, a session staff marked kept because a report rests on it, with its logs,
and a log line already posted in the staff channel. A request
does not delete them, and they still go when their time above is up. A completed request is written down
with your Discord id and character numbers and nothing else, so that an older
backup put back into service has you removed again first. Until every game
server has removed your character, the site also keeps its character numbers
and nothing else, so that a server that has not restarted yet cannot put it
back.

## Who can see it

The Owner, the Co-Owner and the Dev rank, who run the site and the servers,
can see all of it, chat and session records included. The other staff ranks
see the parts their job needs: the staff who work in the world (Gamemasters
and Loremasters) see the staff records and the gallery queue, and calls for
help and reports reach staff in the Discord's staff channels. The logs sent
when a session ends are read on the site by the Owner, the Co-Owner and the
Dev rank only; the one line from them that shows a crash or an error is
posted where all staff can read it. Nothing is sold,
shared or handed to anybody else, and there is nobody to hand it to.

## Children

Thornswood is eighteen and over. If you are under eighteen, do not sign up, and
if you already have, say so and the account will be removed.

## Changes

This page is in the repository with the rest of the site, so every change to it
has a date and an author in the history. If something material changes it will
be said in the Discord rather than quietly edited.

## Cookies

The cookies and browser storage this site uses, what each is for and how long
it lasts, are on the [cookie page](/cookies). None of them is for advertising
or for counting visits.

## Asking about any of this

The Discord, which is linked on every page. A security problem, a way to get
at what this page says is kept, goes to the owner as a Discord direct message,
never in a channel, where everybody would read it. You will hear back within
72 hours.
