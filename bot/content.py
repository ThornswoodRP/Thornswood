# -*- coding: utf-8 -*-
"""
  Everything the build script writes into the read only channels.

  Kept apart from the building so the words can be changed without going near
  the part that creates channels, and so a second run can update the posts
  without making anything twice.
"""

import os
import re

# HOW TO GET IN IS READ OUT OF THE JOIN PAGE, NOT WRITTEN HERE A SECOND TIME.
#
# From the To Do List, entry 185: the start channel promised the old
# installer's exe and zip, "and that the Skyrim you already play will not be
# touched; the person then meets Vortex, a collection and a downgrade."
# #start-here, #welcome and #faq were written by hand for the old installer
# and the site's join page moved on without them. Not one of them said
# Vortex, Nexus or collection.
#
# So #start-here is site\data\site\join.md, and the welcome and the
# questions take what you need and what happens to your own Skyrim out of its
# "What you need" section. Change the page and the next Setup-Discord.ps1
# -Posts says the same thing. join.md rather than help.md because the site's
# pages go out from the repo with each merge's Release, while help.md is
# edited in the hub and a redeploy never overwrites it, so the repo copy of
# help.md is not always the one people read.
#
# The only words here are the ones the page cannot have: which channel a
# ticket goes in and where logs go, as the <#KEY> mentions Build-Discord.py
# fills in.
_JOIN = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     '..', 'site', 'data', 'site', 'join.md')
_SITE = 'https://thornswood.net'

# Build-Discord.py packs paragraphs into messages of up to 1900 characters
# and never splits one, and it deletes the old messages before it sends. A
# paragraph past 2000 would be refused by Discord with the channel already
# half emptied, so a long one is refused here instead, when content.py
# loads and before anything is deleted. 1800 leaves room for the <#KEY>
# mentions growing into real channel ids.
LONGEST_PARAGRAPH = 1800

# THE ONE SWITCH (#428). The site's config.json "open", off unless it says
# true, and handed to this by Setup-Discord.ps1 as THORNSWOOD_OPEN, which reads
# it off https://thornswood.net/api/public so there is one copy of it. Off, the
# posts say what is true today: an alpha, open by application. On, they say
# anyone in the Discord can play, and there is no application to make.
OPEN = os.environ.get('THORNSWOOD_OPEN', '').strip().lower() in ('1', 'true', 'yes', 'open')


def for_mode(md, open_=None):
    """A page with only the wording for this mode. The same markers as
       forMode in site/server.js: <!-- alpha --> ... <!-- /alpha --> and
       <!-- open --> ... <!-- /open --> on lines of their own."""
    if open_ is None:
        open_ = OPEN
    drop = 'alpha' if open_ else 'open'
    md = md.replace('\r\n', '\n')
    md = re.sub(r'(?ms)^<!-- ' + drop + r' -->[ \t]*\n.*?^<!-- /' + drop +
                r' -->[ \t]*(?:\n|\Z)', '', md)
    return re.sub(r'(?m)^<!-- /?(?:alpha|open) -->[ \t]*(?:\n|\Z)', '', md)


def as_discord(md, where='join.md'):
    """A site page as Discord shows it. Links on the site are relative, so
       each becomes the full address, in angle brackets so Discord does not
       put a preview card of the site under every one of them. Discord has no
       horizontal rule, so a --- line would be three dashes on their own."""
    md = md.replace('\r\n', '\n')
    md = '\n'.join(line for line in md.split('\n') if line.strip() != '---')
    md = re.sub(r'\]\((/[^)\s]*)\)', lambda m: '](<' + _SITE + m.group(1) + '>)', md)
    md = re.sub(r'\n{3,}', '\n\n', md).strip()
    for para in md.split('\n\n'):
        if len(para) > LONGEST_PARAGRAPH:
            raise ValueError('%s has a paragraph of %d characters, and Discord '
                             'takes %d at most in one message: "%s..."'
                             % (where, len(para), LONGEST_PARAGRAPH, para[:60]))
    return md


def section(md, heading, where='join.md'):
    """The body under one ## heading, up to the next one."""
    m = re.search(r'^## ' + re.escape(heading) + r'[ \t]*\n(.*?)(?=^## |\Z)',
                  md, re.M | re.S)
    if not m:
        raise ValueError('%s has no "## %s" section, and the Discord text is '
                         'read out of it' % (where, heading))
    return m.group(1).strip()


with open(_JOIN, encoding='utf-8') as _f:
    JOIN = as_discord(for_mode(_f.read()))

# The page without its own "# How to join", which the channel replaces.
_JOIN_BODY = re.sub(r'\A# [^\n]*\n+', '', JOIN)

# "What you need" is four paragraphs, and the one about your own Skyrim is
# the answer to a question of its own. Picked by what it says rather than
# where it sits, and refused if it has gone, because the welcome would
# otherwise quietly lose it. bot\tests\test-read-channels.py runs on
# every pull request, so an edit to join.md that does this goes red there.
_NEED = section(JOIN, 'What you need').split('\n\n')
_YOURS = [p for p in _NEED if 'the Skyrim you already have' in p]
if len(_YOURS) != 1:
    raise ValueError('join.md "What you need" should have one paragraph about '
                     '"the Skyrim you already have", and has %d' % len(_YOURS))
_YOURS = _YOURS[0]
_NEED = '\n\n'.join(p for p in _NEED if p != _YOURS)

_GETTING_IN_ALPHA = """\
## It's an alpha, open by application

Anyone can download it. Getting into the world is an application, and it's
short.

1. Read <#RULES>. The application asks if you accept them.
2. In <#PLAYTEST>, pick **Apply to be an alpha playtester**.
   It asks if you're 18 or over, if you accept the rules, and a few lines
   about who you want to play. Somebody reads it and gets back to you.
3. Once you're accepted you get the Playtester role, and that's what lets you
   press Play.

It's an alpha, so things break. Four people find a bug and it's fixed by the
weekend, so tell us when you find one.

## How to install

Follow <#START>. It's **https://thornswood.net/join** word for word, read out
of the same file, so the two can't disagree. You can install while you wait."""

_GETTING_IN_OPEN = """\
## It's open

Anyone can download it and anyone here can play.

1. Read <#RULES>. Being here and in the world means accepting them.
2. Follow <#START>. It's **https://thornswood.net/join** word for word, read
   out of the same file, so the two can't disagree."""

WELCOME = """\
# Thornswood

Skyrim, except everybody's in the same one.

""" + _YOURS + """

""" + (_GETTING_IN_OPEN if OPEN else _GETTING_IN_ALPHA) + """

## Everything else

It lives on the site, so it can't go stale in here.

**<https://thornswood.net/help>** installing, joining, where your logs are
**<https://thornswood.net/known>** what's broken right now that we know about
**<https://thornswood.net/roadmap>** what's being built
**<https://thornswood.net/credits>** who made what

Say hello in <#GENERAL>.
"""

_ACCEPTING_ALPHA = """\
**Accepting them.** The application in <#PLAYTEST> asks whether you accept
these rules and the ones at **https://thornswood.net/rules**, and your answer is
kept against your Discord account. Applying means accepting them."""

_ACCEPTING_OPEN = """\
**Accepting them.** Being here and in the world means accepting these rules and
the ones at **https://thornswood.net/rules**."""

RULES = """\
# Rules

Seven, because nobody reads twenty.

**1. Don't be a dick.**
No harassment, no slurs, no bigotry, no going after somebody personally. Argue
about the game as much as you like.

**2. Keep it appropriate.**
Nothing sexual involving minors, ever. Nothing graphic in the public channels.
Adult scenes between people who agreed to them beforehand are fine in private.
The full version of that is at **https://thornswood.net/rules**.

**3. Don't wreck somebody else's game.**
No cheating, no exploiting the server, no griefing. If you find something that
lets you break the world, tell us instead of using it. You'll get thanked.

**4. Don't pass the installer around.**
Send people here instead.

**5. Push to talk.**
An open mic with a fan behind it ruins voice for everyone in the room.

**6. Bugs in <#RESULTS>, ideas in <#SUGGESTIONS>.**
They get lost in general. That's not a rule so much as a favour to yourself.

**7. If a Moderator or a Gamemaster tells you to stop, stop.**
You can argue about it afterwards.

You get a word, then a mute, then a removal, depending on what it was. Two and
three skip to the end when they're bad enough.

""" + (_ACCEPTING_OPEN if OPEN else _ACCEPTING_ALPHA) + "\n"

START = """\
# Getting in

This is **https://thornswood.net/join**, read out of the same file, so the two
can't disagree.""" + ("" if OPEN else " Step 1 happens in <#PLAYTEST>.") + """ Logs and crash files go
in <#RESULTS>, with the finding they belong to.

""" + _JOIN_BODY + "\n"

# THE RULES IN THE WORLD ARE READ OUT OF THE RULES PAGE, NOT WRITTEN HERE.
#
# Issue #430: #game-rules, lore\game-rules.md and site\data\site\rules.md
# were three copies of the rules for playing, and they disagreed on the one
# people get removed over: this channel and the lore copy had a fight with
# another character agreed first, the site had it start freely. Patrick
# decided on 28 Sep that fights start freely, and that the site page is the
# only copy. So
# #game-rules is that page's "# In the World" part, to the end of the page,
# and an edit there reaches the channel with the next Setup-Discord.ps1
# -Posts. Paragraphs past LONGEST_PARAGRAPH are refused by as_discord, as
# they are for join.md.
#
# RULES above is a different document, the Discord conduct rules posted in
# #rules, and is left as it is.
_RULES_MD = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         '..', 'site', 'data', 'site', 'rules.md')


def in_the_world(md, where='rules.md'):
    """The rules page's "# In the World" part, from under its heading to the
    next top level heading or the end of the page."""
    md = md.replace('\r\n', '\n')
    m = re.search(r'^# In the World[ \t]*\n(.*?)(?=^# |\Z)', md, re.M | re.S)
    if not m:
        raise ValueError('%s has no "# In the World" part, and #game-rules is '
                         'read out of it' % where)
    return m.group(1).strip()


with open(_RULES_MD, encoding='utf-8') as _f:
    GAME_RULES = """\
# Rules in the world

This is **https://thornswood.net/rules** from "In the World" on, read out of
the same file, so the two can't disagree. <#RULES> is the Discord half.

""" + as_discord(in_the_world(_f.read()), 'rules.md') + "\n"


LORE = """\
# Where you are

**Fourth Era, 252.** Fifty years since the war.

The Stormcloaks won it. The Legion marched out in the first thaw of 203 and the
Moot put the crown on Ulfric. He wore it twenty-six years and died in his
bed.

The Moot sat eleven days and didn't pick his kin. It picked **Eirik
Ravensgard** of the Rift, who's had it twenty-three years and is neither loved
nor hated.

There's a High King of Skyrim and nothing above him. Every hold keeps its own
Jarl, its own court, and its own opinion of everyone else's.

## The Thalmor

Thrown out in 209. Illegal ever since. Still here.

The ones who never made the border went to ground, and their grandchildren are
running gold and poison through the holds under other names. No orders from
home, no cause left, nobody to answer to. That's what makes them dangerous.

## The Empire

Came back in 221 with trade, because it couldn't come back with soldiers.

The White Harbour Accord traded grain for ore and got them one embassy in
Solitude and nothing else. The staff there are polite, and few in Skyrim
trust them.

## What you can play

A Nord out of any hold. An Imperial, legal and watched. A Thalmor remnant,
hunted by everyone including the Empire. A Jarl, a steward, a housecarl, a
guard, a priest, a smith, a hunter.

Not the Dragonborn. Not the Listener. Not the last of anything. Those belong to
the world.

## The rest

Full history and all nine articles of the Accord at
**https://thornswood.net/world**.

Article Four is the one people argue about in taverns: an Imperial standing on
Skyrim's soil is under Skyrim's law, a Nord standing in the embassy is under
the Empire's, and neither side can reach in and drag somebody out.
"""

_FAQ_IN_ALPHA = """\
**Can I bring a friend?**
Yes. Send them to the Discord. They apply the same way you did.

**Why can't I get in?**
It's an alpha, open by application. Anyone can download it, and the
Playtester role is what lets you press Play. In <#PLAYTEST>, pick
**Apply to be an alpha playtester**, and say yes to the rules. Somebody reads
it and gets back to you."""

_FAQ_IN_OPEN = """\
**Can I bring a friend?**
Yes. Send them to the Discord and they can play.

**Why can't I get in?**
Anyone here can play, so it's something else. Open a ticket in <#HELP> and
pick **I need help**."""

FAQ = """\
# Questions

**What do I need?**
""" + _NEED + """

**Will this mess up the Skyrim I already play?**
""" + _YOURS + """

**Can I add mods?**
No. Everyone has to be running the identical plugin list or nobody connects.
Want something in? Say so in <#SUGGESTIONS>. It goes in for everybody or not at
all.

**Why can't I save?**
Your character lives on the server, so quit whenever you like, nothing is lost.
A few mod settings menus still forget their settings every session. That is a
bug being fixed, and **https://thornswood.net/known** names them.

**Why is that NPC just standing there?**
The server runs the NPCs, so they carry on whether anybody is near or not. One
frozen in place that never moves is worth a report in <#RESULTS>.

**Fast travel?**
Off. So is levelling. Difficulty is locked.

**Something's broken.**
Check **https://thornswood.net/known** first. It lists what is broken right now
that we already know about. If it isn't there, <#RESULTS>.

""" + (_FAQ_IN_OPEN if OPEN else _FAQ_IN_ALPHA) + "\n"

LINKS = """\
# Links

**The site** https://thornswood.net
Everything in one place: the installer, help, what is broken, what is coming.

**Install help** https://thornswood.net/help
**What is broken right now** https://thornswood.net/known
**What is coming** https://thornswood.net/roadmap
**Report something** https://thornswood.net/report
**Send a screenshot or a log** https://thornswood.net/uploads

## Built on

**SkyMP** the multiplayer engine this runs on. Skyrim was not built to be
played together and SkyMP is what makes it possible at all.

**SKSE** and **Skyrim Platform**, which everything else stands on.

The mod list is long and every author on it made this worth playing. Their
pages are in the launcher, one click each.
"""

NEWS_FIRST = """\
Release notes land here on their own every time an update goes out, straight
from the launcher, so this channel and the Play button never disagree.

The same list, with the file changes, is at **https://thornswood.net/news**.
"""

BUGS_TOPIC = "One post per problem. Logs and screenshots welcome."
SUGGEST_TOPIC = ("Mods and features you want. Nexus link if it's a mod, "
                 "because whether it works here depends on how it's built.")

HOLD_TOPICS = {
    'whiterun':   "Everybody passes through eventually.",
    'solitude':   "Court, trade, and the one Imperial embassy left in Skyrim.",
    'windhelm':   "The High King sits here.",
    'riften':     "Fish, mead, and the Ratway under the canal.",
    'markarth':   "Stone, silver, and grudges older than the war.",
    'dawnstar':   "Cold. The ships still come in.",
    'morthal':    "A swamp, a few houses, and the Jarl's hall.",
    'falkreath':  "Pines, and a graveyard bigger than the town.",
    'winterhold': "What's left of it.",
    'raven-rock': "On Solstheim, across the water. The ash still falls.",
}


# ------------------------------------------------------- the staff spaces --
# The rules of each staff space and of the Playtesters category (#3317,
# Patrick, 22 Oct 2026). Drafted by Claude from what the repository already
# says, for each lead and Patrick to approve (page card 10d). A draft is in
# DRAFTS and is never posted: the build says it waits. Approving one is
# taking it out of DRAFTS and giving it its first change line in CHANGES.

_COUNCIL = """\
**The council.** Every staff category has a lead. The leads are the council:
they decide together, and the Owner and Co-Owner make the final call. What the
council decides is posted in #council-decisions with its date.

**One rank per category.** Nobody holds two ranks of the same category, such
as Dev and Lead Dev, or Gamemaster and Trial Gamemaster. Ranks in two
different categories are fine, and so is Owner or Co-Owner with a lead role.
Whoever gives a rank takes the lower one in that category off. The audit of
the Discord lists anybody holding two, and the council fixes it.

**The channels here.** The announcements channel is read by everyone in this
category, and only the Owner, the Co-Owner and the leads post in it. This
rules channel is posted in by this category's lead, the Owner and the
Co-Owner; every change to it is listed in its Changelog thread with the date.
The chat and the voice room are for working together."""

DEV_RULES = """\
# Dev

**What Devs do.** The server, the launcher, the site, the bot and the mods:
anything that compiles or ships. The work is on the board on GitHub, and
every change goes to the dev build first, where the team checks nothing
breaks the game, then to main, where playtesters test it.

**The rules for the work** are in Developer-Guide.md in the repository, and
they bind everybody who works on it, with AI or without: one issue, one
branch, one pull request; fix the cause, never a band-aid; everything found
goes on the board.

**The dev build.** Devs, the leads, the Owner and the Co-Owner can install
the dev build and join the dev server. Nobody else can. What is on dev stays
here until it reaches main.

**Dev test tasks** are in #dev-test-tasks, kept by the bot from the board.
What you measured goes in #dev-test-results.

""" + _COUNCIL + "\n\n**The lead** is the Lead Dev.\n"

LORE_RULES = """\
# Lore

**What Loremasters do.** Write the lore of Thornswood, keep it straight, and
watch that what happens in the world stays inside it. The world is fifty
years after the civil war the Stormcloaks won: a High King over the Jarls,
the Thalmor expelled, and the Empire back under a trade treaty with one
embassy. What is written is in the lore folder of the repository and in
#lore.

**Events.** Loremasters help with events when asked. They read the
Gamemasters' #gm-announcements, #gm-event-plans and #gm-scene-summaries, so
an event is checked against the lore before it runs and after it ends. A
problem with a scene goes to the Lead Gamemaster, not into the scene.

""" + _COUNCIL + "\n\n**The lead** is the Lead Loremaster.\n"

MOD_RULES = """\
# Moderation

**What Moderators do.** Moderate the Discord: the channels, the threads and
the voice rooms. Moderators have no staff powers in the game; trouble in the
world goes to the Gamemasters.

**How.** Ask first, then time out, then remove. The steps are the ones on
https://thornswood.net/rules. A report about somebody goes in a ticket, never
in a channel where that person can read it, and closed tickets are kept in
#ticket-log.

**What stays here.** Who was warned, timed out or removed, and why, is
written down for the other Moderators and the council. Nothing about a
report is repeated outside staff.

""" + _COUNCIL + "\n\n**The lead** is the Lead Moderator.\n"

CONTENT_RULES = """\
# Content

**What Content Creators do.** Make content for Thornswood itself and its own
social media: clips, screenshots, posts and videos that go out under the
Thornswood name. This is not the role for community creators who make their
own videos about the server.

**What can be shown.** Only what is on main, never the dev build, and
nobody's character in a way they would not agree to. Ask before naming
somebody.

**Before it goes out.** Anything posted on a Thornswood account is seen in
#content-chat first, and the Lead Content Creator says when it goes.

""" + _COUNCIL + "\n\n**The lead** is the Lead Content Creator.\n"

SUPPORT_RULES = """\
# Support

**What Support does.** Help people with install, update and connection
trouble in their "I need help" tickets, and read the applications to become
a playtester. Every other application is read by the Owner, the Co-Owner,
the council, and that staff category for a staff application.

**Helping.** The launcher's Scan and Fix is the first step for most
problems, and the launcher's log is where the answer usually is. What you
cannot fix goes on the board on GitHub with what you saw, so it is fixed
once for everybody.

**Applications.** Read the answers, and accept only someone who said yes to
being eighteen or over and yes to the rules.

""" + _COUNCIL + "\n\n**The lead** is the Lead Support.\n"

TESTER_RULES = """\
# Playtesting

**What playtesters do.** Play Thornswood on main while it is in alpha, and
say what breaks. You are not staff: this is your space, and the staff who
read it are here to fix what you find.

**Test tasks** are in #test-tasks, one thread each: what to try and what
should happen. Say in the thread whether it did.

**A finding** goes in #test-findings: what you did, what you expected, what
happened, and the time. Logs and screenshots help. What the team already
knows about is in #known-issues, so look there first.

**Sessions** are called in #playtest-sessions, so people can be in the world
at the same time.

**Announcements** for playtesters are in #playtester-announcements, posted
by the Owner, the Co-Owner and the staff leads.
"""

# The sixteen factions of 4E 252 (#3317): lore/factions.md, which Patrick
# approved on 22 Oct, read out of the file so #factions and the repository
# cannot disagree. Setup-Discord -OnBox sends the file with this one.
_FACTIONS_MD = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            '..', 'lore', 'factions.md')
with open(_FACTIONS_MD, encoding='utf-8') as _f:
    FACTIONS = as_discord(_f.read(), 'factions.md')

# Every channel the build writes, by its key in PLAN: its words.
DOCS = {
    'RULES': RULES,
    'WELCOME': WELCOME,
    'START': START,
    'NEWS': NEWS_FIRST,
    'FAQ': FAQ,
    'GAMERULES': GAME_RULES,
    'LORE': LORE,
    'FACTIONS': FACTIONS,
    'TESTERRULES': TESTER_RULES,
    'DEVRULES': DEV_RULES,
    'LORERULES': LORE_RULES,
    'MODRULES': MOD_RULES,
    'CONTENTRULES': CONTENT_RULES,
    'SUPPORTRULES': SUPPORT_RULES,
}

# Waiting on their lead's and Patrick's approval (#3317, 10d). Never posted.
DRAFTS = ('TESTERRULES', 'DEVRULES', 'LORERULES', 'MODRULES',
          'CONTENTRULES', 'SUPPORTRULES')

# THE CHANGELOGS (#3317, Patrick, 22 Oct: "any of the rules and documentation
# in the discord needs a proper changelog so poeple can easily see what
# changes and when"). One list per doc, oldest first: the date, one plain line
# saying what changed and why, and the fingerprint of the words it describes.
# The build posts each line once in the channel's Changelog thread and ends
# the post with the newest one, and it refuses to run while a doc's words
# have no line: changing a doc is adding its line here. The fingerprint to
# write is the one the refusal prints (Build-Discord.py, check_docs), and
# the pull request's build prints it too (tests/test-3457-doc-change-lines.py).
CHANGES = {
    'RULES': [
        ('2026-10-22', 'The changelog starts here; earlier changes are in the repository history. Bugs now go in #test-findings, since #bugs is gone.', '8c8eaaa1c0c2'),
        ('2026-10-22', 'The application that asks whether you accept these is in its own channel now.', 'a61e1b4d9c57'),
    ],
    'WELCOME': [
        ('2026-10-22', 'The changelog starts here; earlier changes are in the repository history.', '4a290d7afd52'),
        ('2026-10-22', 'The help, known issues, roadmap and credits lines are links you can click, and the playtest application is in its own channel now.', 'a290f9d3bc8f'),
        ('2026-10-26', 'The known issues link now says what that page is: what is broken right now that we know about. What works that way on purpose is on the help page.', 'ce6ac2b915a6'),
        ('2026-10-26', 'Only the line breaks of the Vortex profile sentence moved; no words changed.', '938f8250a962'),
    ],
    'START': [
        ('2026-10-22', 'The changelog starts here; earlier changes are in the repository history. Logs and crash files now go in #test-findings, since #logs-and-crashes is gone.', '8a49f1c3335b'),
        ('2026-10-22', 'Step 1, the playtest application, is in its own channel now.', '9464b08ac76a'),
        ('2026-10-26', 'If it goes wrong: the known issues page lists what is broken right now, and the help page has what works that way on purpose.', 'ca32544d805a'),
        ('2026-10-26', 'Your first character has its own section: the stone hall, the nine towns you can start in and where you arrive, what waits on a class or a profession, and the tool a Miner, a Farmer, a Fisher or a Woodworker is handed. Connect Discord is on the Play page, and voice names its keys: hold V to talk, O keeps the microphone open, B steps between whisper, normal and yell.', 'e4e76eaea6bf'),
        ('2026-10-26', 'If it goes wrong: the help page has the usual fixes. Its list of what works that way on purpose is gone.', '3c1f3de182b5'),
        ('2026-10-27', "For Thornswood's own plugin, Fix downloads the latest release's copy, no longer the server's.", '1592da4dfb29'),
        ('2026-10-30', 'Step 3: the collection link on the Downloads page, the card above Play and the Diagnostics page opens the revision the server was built against. Install that one, not a newer one Nexus may show first, which keeps Play shut until the server catches up.', 'aa62cb6eaf57'),
    ],
    'NEWS': [
        ('2026-10-22', 'The changelog starts here; earlier changes are in the repository history.', '90be4dab837f'),
    ],
    'FAQ': [
        ('2026-10-22', 'The changelog starts here; earlier changes are in the repository history. Something broken now points at #test-findings, since #bugs is gone.', '199e5f79c8af'),
        ('2026-10-22', 'The playtest application and help tickets are each in their own channel now.', 'f4cf53ba6ce4'),
        ('2026-10-26', 'NPCs carry on with nobody near now, so the answers about NPCs standing still and the same bandit acting differently are gone. Only a few mod menus still reset, and the known issues page lists only what is actually broken.', 'a2dbef6430b1'),
        ('2026-10-26', 'Only a comma and some line breaks moved; no answer changed.', '91bab9b34c87'),
        ('2026-10-26', 'Mod settings menus that forget their settings are a bug being fixed, not how it is meant to work. The fast travel answer no longer points at a list on the help page, which is gone.', 'b1263b3db33e'),
    ],
    'GAMERULES': [
        ('2026-10-22', 'The changelog starts here; earlier changes are in the repository history.', '037bba896ff5'),
        ('2026-10-22', 'Titles: a Jarl seat is asked for on the Jarl application, which lists only the holds with no Jarl, and a Jarl names their hold\'s steward, court and guards.', '859039c7cdd4'),
        ('2026-10-26', 'The chat log is read only by the Owner, the Co-Owner and the Dev rank, and is kept for 365 days, then dropped.', '755ede28b88f'),
    ],
    'LORE': [
        ('2026-10-22', 'The changelog starts here; earlier changes are in the repository history.', '6719c4f60917'),
        ('2026-10-22', 'Rewritten without the narrator asides, so it reads as plain lore. No event in it has changed.', 'fb95f2f38532'),
        ('2026-10-27', 'Eirik has held the crown twenty-three years, not twenty-two: Ulfric died in 4E 229 and this is 4E 252.', 'e33f97399598'),
    ],
    'FACTIONS': [
        ('2026-10-22', 'The sixteen factions of 4E 252, each with who they are, where they keep and who leads them.', '8ba2250523f8'),
        ('2026-10-27', 'No Legion soldier has been in Skyrim under arms in fifty years, not thirty: the Legion left in the thaw of 203.', '16480e79786c'),
    ],
}


# THE FINGERPRINTS (#3457). Here rather than in Build-Discord.py so a pull
# request's build can check every doc has its change line without discord.py
# (tests/test-3457-doc-change-lines.py). #3445 rewrote the join and rules
# pages, which #start-here, #welcome, #faq and #game-rules are read out of, and
# merged green because only the nightly ran the bot's harnesses; the next
# Discord build would have refused to run. Every doc's words are fingerprinted
# as both the alpha and the open wording say them (the one switch, OPEN), so
# flipping the switch is a change that needs its line as well.

def doc_texts(key):
    """(alpha words, open words) of one doc, each from a fresh read of
       this file with the switch set, so neither depends on how this run
       was started."""
    import importlib.util
    out = []
    old = os.environ.get('THORNSWOOD_OPEN')
    try:
        for flag in ('0', '1'):
            os.environ['THORNSWOOD_OPEN'] = flag
            spec = importlib.util.spec_from_file_location(
                'content_' + flag, os.path.abspath(__file__))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            out.append(mod.DOCS[key])
    finally:
        if old is None:
            os.environ.pop('THORNSWOOD_OPEN', None)
        else:
            os.environ['THORNSWOOD_OPEN'] = old
    return tuple(out)


def doc_print(key):
    """The fingerprint of a doc's words: twelve hex digits of their sha256."""
    import hashlib
    a, b = doc_texts(key)
    return hashlib.sha256((a + '\0' + b).encode('utf-8')).hexdigest()[:12]


# WHAT A PUBLIC LINE NEVER SAYS (#3656). A doc's words and its change lines
# are read by everybody in the Discord, and the change lines end every post.
# On 27 Oct two of them went out saying "Patrick confirmed it (#3656)", and
# one "as Patrick approved them": how the team works, not what changed. A
# change line says what changed in the world or the rules, in the reader's
# words. These are refused in every change line and in the words of every doc
# that is not a draft: an issue or pull request number, and the names of the
# people and the AI who work on it. A channel name (#lore) is not a number.
NOT_PUBLIC = (
    (r'#\d', 'an issue or pull request number'),
    (r'\b(?:Patrick|Djinn|WiccanDjinn|Jhinswife|Claude)\b',
     'a name of somebody on the team, which says how it was decided, not what changed'),
)


def not_public(text):
    """What in text a public line never says, as (what, the words) pairs, []
       when it is fine."""
    import re
    out = []
    for pattern, what in NOT_PUBLIC:
        for m in re.finditer(pattern, text or ''):
            a, b = max(0, m.start() - 30), min(len(text), m.end() + 30)
            out.append((what, text[a:b].replace('\n', ' ')))
    return out


def unpublic(keys):
    """(key, where, what, the words) of every change line, and of the words
       of every doc that is not a draft, in keys that says something a public
       line never says. [] when none does."""
    out = []
    for key in keys:
        for d, line, _fp in CHANGES.get(key) or []:
            for what, words in not_public(line):
                out.append((key, 'its change line of ' + d, what, words))
        if key not in DRAFTS:
            for what, words in not_public(DOCS.get(key, '')):
                out.append((key, 'its words', what, words))
    return out


def unrecorded(keys):
    """(key, fingerprint) of each doc in keys, drafts aside, whose words have
       no change line: CHANGES has none for it, or its newest is for other
       words. [] when every one has its line."""
    out = []
    for key in keys:
        if key in DRAFTS:
            continue
        lines = CHANGES.get(key) or []
        fp = doc_print(key)
        if not lines or lines[-1][2] != fp:
            out.append((key, fp))
    return out
