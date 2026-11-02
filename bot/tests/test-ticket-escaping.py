"""
test-ticket-escaping.py

Nothing somebody types into an application can ping anybody, and nothing in it
is read as formatting.

Issue #1354. The answers on a ticket form are typed by whoever is applying,
and until this they went into the private thread exactly as typed. An answer
of "@everyone" pinged the server from inside a staff thread, a role mention
pulled a role in, and a line of asterisks hid the rest of the application
behind a heading. The same words went into the staff only channel when the
thread would not open.

Three things stop it now, and this checks all of them: the words are escaped on
the way into Discord (as_typed), every post that carries them is sent with
mentions switched off, so a mention the escaping does not know about still
pings nobody, and every ticket post suppresses embeds, so a bare link in an
answer cannot draw its preview.
The site copy is checked as well, because it keeps the answers as typed and
the page escapes its own output.

The real bot module is imported and the real TicketModal.on_submit is run. Only
what touches the world is replaced: the guild, its channels, threads and roles,
the interaction, the push to the site, and the file of open tickets, which is
pointed at a temporary folder so this cannot touch the one beside the code.

Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import shutil
import tempfile

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
# The defaults are what is being tested, so nothing in this shell may move them.
for _k in ('TICKET_CHANNEL', 'TICKET_LOG', 'STAFF_ROLES', 'TICKET_COOLDOWN'):
    os.environ.pop(_k, None)

import discord  # noqa: E402

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


# What somebody hostile puts in the boxes. Every one of these is a thing that
# works in Discord when it is posted as typed.
SHOUT = '@everyone @here'
PULL = '<@&1234567890123456789>'
LOUD = '**LET ME IN** # not a heading'
MASKED = '[thornswood.net](https://not-thornswood.example/steal)'


# ------------------------------------------------------------- the world --
class Role(object):
    def __init__(self, name, members=()):
        self.name = name
        self.members = list(members)
        self.mention = '<@&%s>' % name


class Person(object):
    def __init__(self, uid, name, roles=()):
        self.id = uid
        self.name = name
        self.display_name = name
        self.mention = '<@%d>' % uid
        self.roles = list(roles)
        self.bot = False
        self.dms = []

    def __str__(self):
        return self.name

    async def send(self, text=None, **kw):
        self.dms.append(text or '')


class Perms(object):
    """Everything allowed for the bot, nothing special for anybody else."""

    def __init__(self, everything):
        self.everything = everything

    def __getattr__(self, _name):
        return self.everything


class Posts(object):
    """Somewhere posts land, each kept with the keywords it was sent with."""

    def __init__(self):
        self.sent = []

    async def send(self, text=None, **kw):
        await asyncio.sleep(0)
        self.sent.append((text or '', kw))

    def texts(self):
        return [t for t, _ in self.sent]

    def body(self):
        """Everything after the opening post, which is the head."""
        return '\n\n'.join(t for t, _ in self.sent[1:])


class Thread(Posts):
    def __init__(self, tid, name):
        Posts.__init__(self)
        self.id = tid
        self.name = name
        self.archived = False
        self.mention = '<#%d>' % tid
        self.added = []

    async def add_user(self, m):
        self.added.append(m)


class Channel(Posts):
    def __init__(self, name, guild, refuse=False):
        Posts.__init__(self)
        self.name = name
        self.guild = guild
        self.refuse = refuse
        self.made = []

    def permissions_for(self, who):
        return Perms(who is self.guild.me)

    async def create_thread(self, name=None, **k):
        await asyncio.sleep(0)
        if self.refuse:
            raise RuntimeError('403 Forbidden (error code: 50013): '
                               'Missing Permissions')
        t = Thread(9000 + len(self.made), name)
        self.made.append(t)
        self.guild.threads[t.id] = t
        return t


class Guild(object):
    def __init__(self, gid, staff, refuse=False):
        self.id = gid
        self.name = 'Thornswood'
        self.me = Person(1, 'Thornswood')
        self.me.bot = True
        self.threads = {}
        self.roles = [Role('Moderator', [staff])]
        self.text_channels = [Channel(bot.TICKETS[0], self, refuse)]

    def get_thread(self, tid):
        return self.threads.get(tid)


class Response(object):
    def __init__(self):
        self.said = []

    async def send_message(self, text, ephemeral=False, **k):
        self.said.append((text, ephemeral))

    async def defer(self, **k):
        await asyncio.sleep(0)


class Followup(object):
    def __init__(self):
        self.said = []

    async def send(self, text, ephemeral=False, **k):
        self.said.append((text, ephemeral))


class Interaction(object):
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        self.channel = guild.text_channels[0]
        self.response = Response()
        self.followup = Followup()


# ------------------------------------------------------ what gets replaced --
PUSHED = []


async def _push(*a):
    PUSHED.append(a)

bot.push_async = _push
bot.KEY = ''

LOGGED = []
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))

BOOK = None


async def _book(_guild):
    return BOOK


def send(guild, who, kind, answers):
    """One application, answered in order, run through the real on_submit."""
    lab = dict((a, b) for a, b, _ in bot.KINDS)[kind]
    m = bot.TicketModal(kind, lab)
    for f, a in zip(m.fields, answers):
        f._value = a
    bot._last_ticket.clear()
    i = Interaction(guild, who)
    asyncio.run(m.on_submit(i))
    return i


def off(kw):
    """Whether a post was sent with every mention switched off."""
    am = kw.get('allowed_mentions')
    return (isinstance(am, discord.AllowedMentions)
            and not am.everyone and not am.users and not am.roles)


def quiet_everyone(kw):
    """Whether a post was sent with @everyone and @here switched off."""
    am = kw.get('allowed_mentions')
    return isinstance(am, discord.AllowedMentions) and not am.everyone


def no_preview(kw):
    """Whether a post was sent with Discord link previews switched off."""
    return kw.get('suppress_embeds') is True


TMP = tempfile.mkdtemp(prefix='thornswood-escaping-')
bot.OPEN_TICKETS = os.path.join(TMP, 'open-tickets.json')

try:
    # ------------------------------------------------------ the escaping itself
    yes('E1 as_typed leaves an ordinary sentence alone',
        bot.as_typed('It will not connect from the desktop shortcut')
        == 'It will not connect from the desktop shortcut')
    yes('E1 it breaks up @everyone and @here',
        '@everyone' not in bot.as_typed(SHOUT)
        and '@here' not in bot.as_typed(SHOUT)
        and 'everyone' in bot.as_typed(SHOUT))
    yes('E1 and a role mention', PULL not in bot.as_typed(PULL))
    yes('E1 and markdown is shown as it was typed',
        '\\*\\*' in bot.as_typed('**bold**'))
    yes('E1 and a masked link shows where it really goes',
        '\\[' in bot.as_typed(MASKED))
    yes('E1 nothing at all is nothing, not the word None',
        bot.as_typed(None) == '' and bot.as_typed('   ') == '')
    yes('E1 and one long answer is cut rather than carried whole',
        len(bot.as_typed('a' * 5000, 100)) == 100)

    # ------------------------------------------------- THE ONE THIS IS FOR
    #
    # A help ticket, every box filled in with something that works in Discord.
    mo = Person(103, 'Mo', [Role('Moderator')])
    G = Guild(1, mo)
    CH = G.text_channels[0]
    ada = Person(101, 'Ada')

    sent = send(G, ada, 'help', [SHOUT, PULL + ' ' + LOUD, MASKED])
    yes('T1 the thread opened', len(CH.made) == 1)
    T = CH.made[0]
    said = T.body()

    yes('T1 the answers are in the thread',
        'everyone' in said and 'LET ME IN' in said)
    yes('T1 but no @everyone or @here is left live in them',
        '@everyone' not in said and '@here' not in said)
    yes('T1 and no role mention is left live', PULL not in said)
    yes('T1 and their asterisks are shown, not obeyed', '\\*\\*' in said)
    yes('T1 and their masked link shows itself', '\\[' in said)
    yes('T1 while our own questions are still bold',
        '**What is going wrong?**' in said)

    yes('T1 every post carrying their words switches mentions off',
        len(T.sent) > 1 and all(off(kw) for _, kw in T.sent[1:]))
    yes('T1 the opening post still pulls staff in',
        '<@&Moderator>' in T.texts()[0])
    yes('T1 and it never says @everyone, whatever a name holds',
        quiet_everyone(T.sent[0][1]))
    yes('T1 every post of it suppresses link previews',
        T.sent and all(no_preview(kw) for _, kw in T.sent))

    yes('T1 and the person was told where their ticket is',
        len(sent.followup.said) == 1 and T.mention in sent.followup.said[0][0])

    # The site keeps what they really wrote. The page escapes its own output,
    # and the inbox is the record of the application.
    yes('T1 the site copy keeps the answers as typed',
        len(PUSHED) == 1 and SHOUT in PUSHED[0][2] and PULL in PUSHED[0][2])

    # ----------------------------------------------------- the flagged lines
    #
    # An age or rules answer that does not read as a yes is quoted at the top
    # of the thread, so that quote is their words as well.
    ben = Person(102, 'Ben')
    send(G, ben, 'playtest',
         ['no ' + SHOUT, 'no ' + PULL, 'A Nord who talks too much',
          'Evenings', 'It would not start'])
    flagged = CH.made[1].body()
    yes('T2 the application is flagged for staff to read',
        flagged.count('**CHECK THIS ONE.**') == 2)
    yes('T2 and the quote of what they said cannot ping anybody',
        '@everyone' not in flagged and '@here' not in flagged
        and PULL not in flagged)
    yes('T2 with every post of it still sent with mentions off',
        all(off(kw) for _, kw in CH.made[1].sent[1:]))
    yes('T2 and every post of it suppresses link previews',
        CH.made[1].sent and all(no_preview(kw) for _, kw in CH.made[1].sent))

    # ------------------------------------------- when no thread will open
    #
    # The whole ticket goes to the staff only channel instead, and it carries
    # the same words, so it gets the same treatment.
    BOOK = Posts()
    bot.log_channel = _book
    shut = Guild(2, mo, refuse=True)
    cal = Person(104, '**Cal** ' + SHOUT)
    out = send(shut, cal, 'report', [SHOUT, PULL + ' ' + LOUD, MASKED])

    yes('T3 nothing could open, so it went to the staff only channel',
        len(BOOK.sent) > 1)
    whole = '\n\n'.join(BOOK.texts())
    yes('T3 and nothing in it can ping anybody',
        '@everyone' not in whole and '@here' not in whole and PULL not in whole)
    yes('T3 including the display name in its title', '\\*\\*Cal\\*\\*' in whole)
    yes('T3 their words are still there to read',
        'LET ME IN' in whole and 'everyone' in whole)
    yes('T3 every post of their words switches mentions off',
        all(off(kw) for _, kw in BOOK.sent[1:]))
    yes('T3 and the first post never says @everyone',
        quiet_everyone(BOOK.sent[0][1]))
    yes('T3 every post of it suppresses link previews',
        BOOK.sent and all(no_preview(kw) for _, kw in BOOK.sent))
    yes('T3 while the person is told it reached staff',
        len(out.followup.said) == 1
        and 'staff' in out.followup.said[0][0].lower())

finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
