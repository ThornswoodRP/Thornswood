"""
test-tickets.py

One open ticket per person, and one new ticket every five minutes.

From the To Do List: "A public panel that auto-adds staff to every thread is
otherwise a free way to ping every moderator fifty times a minute". Before
this, picking from the panel sent the form and nothing else: no look at who
was asking, at what they already had open, or at when they last sent one.

The real bot module is imported, and the real TicketPicker.callback and
TicketModal.on_submit are run. Only what touches the world is replaced: the
guild, its channel and threads, the interaction, the push to the site, the
clock, and the file of open tickets, which is pointed at a temporary folder so
this cannot touch the one beside the code.

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
import json
import shutil
import tempfile

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


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

    def __str__(self):
        return self.name

    async def send(self, *a, **k):
        pass


class Broken(Person):
    """Somebody the check cannot read, to prove a failing check lets them in."""
    @property
    def id(self):
        raise RuntimeError('no id today')

    @id.setter
    def id(self, _v):
        pass


class Perms(object):
    """Everything allowed for the bot, nothing special for anybody else."""
    def __init__(self, everything):
        self.everything = everything

    def __getattr__(self, _name):
        return self.everything


class Thread(object):
    def __init__(self, tid, name):
        self.id = tid
        self.name = name
        self.archived = False
        self.mention = '<#%d>' % tid
        self.added = []

    async def add_user(self, m):
        self.added.append(m)

    async def send(self, *a, **k):
        pass


class Channel(object):
    def __init__(self, name, guild):
        self.name = name
        self.guild = guild
        self.made = []

    def permissions_for(self, who):
        return Perms(who is self.guild.me)

    async def create_thread(self, name=None, **k):
        await asyncio.sleep(0)       # a real one is a round trip to Discord
        t = Thread(9000 + len(self.made), name)
        self.made.append(t)
        self.guild.threads[t.id] = t
        return t

    async def send(self, *a, **k):
        pass


class Guild(object):
    def __init__(self, gid, staff):
        self.id = gid
        self.name = 'Thornswood'
        self.me = Person(1, 'Thornswood')
        self.me.bot = True
        self.threads = {}
        self.roles = [Role('Moderator', [staff])]
        self.text_channels = [Channel(bot.TICKETS[0], self)]

    def get_thread(self, tid):
        # The real cache drops an archived thread straight away. This one keeps
        # it, so the check has to look at archived itself as well.
        return self.threads.get(tid)


class Response(object):
    def __init__(self):
        self.modals = []
        self.said = []
        self.deferred = 0

    async def send_modal(self, modal):
        self.modals.append(modal)

    async def send_message(self, text, ephemeral=False, **k):
        self.said.append((text, ephemeral))

    async def defer(self, **k):
        self.deferred += 1
        await asyncio.sleep(0)       # so two forms sent at once interleave


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
CLOCK = [1000.0]
bot._now = lambda: CLOCK[0]

PUSHED = []


async def _push(*a):
    PUSHED.append(a)

bot.push_async = _push
bot.KEY = ''

LOGGED = []
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))

REFUSALS = []


def forget():
    """What a restart does to the in-memory half."""
    getattr(bot, '_last_ticket', {}).clear()


async def _pick(guild, user, kind):
    i = Interaction(guild, user)
    p = bot.TicketPicker()
    p._values = [kind]
    await p.callback(i)
    REFUSALS.extend(t for t, _ in i.response.said)
    return i


async def _send(guild, user, kind):
    lab = dict((a, b) for a, b, _ in bot.KINDS)[kind]
    m = bot.TicketModal(kind, lab)
    for f in m.fields:
        f._value = 'yes'
    i = Interaction(guild, user)
    await m.on_submit(i)
    REFUSALS.extend(t for t, _ in i.response.said)
    return i


def pick(guild, user, kind='playtest'):
    return asyncio.run(_pick(guild, user, kind))


def send(guild, user, kind='playtest'):
    return asyncio.run(_send(guild, user, kind))


def stored():
    try:
        with open(bot.OPEN_TICKETS) as f:
            return json.load(f)
    except Exception:
        return None


TMP = tempfile.mkdtemp(prefix='thornswood-tickets-')
bot.OPEN_TICKETS = os.path.join(TMP, 'open-tickets.json')

try:
    mo = Person(103, 'Mo', [Role('Moderator')])
    G = Guild(1, mo)
    CH = G.text_channels[0]
    ann = Person(101, 'Ann')
    bea = Person(102, 'Bea')

    # ------------------------------------------------ the way in still works
    #
    # A bug in the check that refused everybody would refuse every playtest
    # application too, and that is the only way into the world.
    first = pick(G, ann)
    yes('somebody with no ticket open gets the form',
        len(first.response.modals) == 1 and not first.response.said)

    again = pick(G, ann)
    yes('picking again before sending anything still gets the form, so a '
        'form cancelled by mistake costs nothing',
        len(again.response.modals) == 1 and not again.response.said)

    sent = send(G, ann)
    yes('sending it opens one thread', len(CH.made) == 1)
    yes('and answers with the thread',
        len(sent.followup.said) == 1 and CH.made[0].mention in sent.followup.said[0][0])
    yes('and pushes one copy to the site inbox', len(PUSHED) == 1)
    yes('and writes down which thread is theirs',
        (stored() or {}).get('1:101') == CH.made[0].id)

    # ----------------------------------------------------- THE ONE THIS IS FOR
    #
    # The done-when on the entry: the picker driven twice for the same person
    # inside the cooldown, send_modal once and send_message once. The first
    # pick is the one above, before the form was sent.
    CLOCK[0] += 30
    second = pick(G, ann)
    yes('picking again inside the cooldown does not open the form',
        not second.response.modals)
    yes('it says why instead, once',
        len(second.response.said) == 1)
    yes('across the two picks: send_modal once, send_message once',
        len(first.response.modals) + len(second.response.modals) == 1
        and len(first.response.said) + len(second.response.said) == 1)
    yes('only to them', second.response.said and second.response.said[0][1] is True)
    yes('and it links the ticket they already have open',
        second.response.said and CH.made[0].mention in second.response.said[0][0])

    # --------------------------------------------- nobody else is held up by it
    other = pick(G, bea)
    yes('somebody else still gets the form',
        len(other.response.modals) == 1 and not other.response.said)

    # ------------------------------------------------ a closed ticket, then time
    #
    # Close archives the thread. With it closed, the cooldown is what is left,
    # and it says how long in minutes rather than in seconds.
    CH.made[0].archived = True
    CLOCK[0] = 1000.0 + 60
    shut = pick(G, ann)
    yes('a closed ticket inside the cooldown is still refused',
        not shut.response.modals and len(shut.response.said) == 1)
    yes('and says how long, rounded up: four minutes after one',
        shut.response.said and '4 minutes' in shut.response.said[0][0])
    yes('and does not point at the closed thread',
        shut.response.said and CH.made[0].mention not in shut.response.said[0][0])

    CLOCK[0] = 1000.0 + 250
    nearly = pick(G, ann)
    yes('one minute is one minute, not one minutes',
        nearly.response.said and '1 minute.' in nearly.response.said[0][0])

    CLOCK[0] = 1000.0 + getattr(bot, 'TICKET_COOLDOWN', 300) + 1
    later = pick(G, ann)
    yes('once the cooldown is over, and the old ticket closed, the form opens',
        len(later.response.modals) == 1 and not later.response.said)

    # ------------------------------------------------------------ a restart
    #
    # The cooldown is in memory and a restart forgets it, which is fine. The
    # open ticket is not allowed to be forgotten, because the process restarts
    # in a loop and a rule that forgets on every restart is not a rule.
    send(G, ann)
    yes('a second ticket opens once the first is closed and the time is up',
        len(CH.made) == 2)
    yes('and the closed one is dropped from the file as the new one is written',
        stored() == {'1:101': CH.made[1].id})
    forget()
    back = pick(G, ann)
    yes('after a restart an open ticket still refuses a second',
        not back.response.modals and back.response.said
        and CH.made[1].mention in back.response.said[0][0])

    # A ticket staff deleted rather than closed is gone from the cache too.
    del G.threads[CH.made[1].id]
    gone = pick(G, ann)
    yes('a deleted ticket lets them through',
        len(gone.response.modals) == 1 and not gone.response.said)

    # ---------------------------------------------- two forms sent at once
    #
    # The form can be opened more than once before any of them is sent, so the
    # check is repeated when a form comes back, and the time is written down
    # before anything waits on Discord.
    cal = Person(104, 'Cal')
    made = len(CH.made)
    pushed = len(PUSHED)

    async def both():
        lab = dict((a, b) for a, b, _ in bot.KINDS)['help']
        forms, calls = [], []
        for _ in range(2):
            m = bot.TicketModal('help', lab)
            for f in m.fields:
                f._value = 'it will not start'
            forms.append(m)
            calls.append(Interaction(G, cal))
        await asyncio.gather(*(m.on_submit(i) for m, i in zip(forms, calls)))
        return calls

    pair = asyncio.run(both())
    REFUSALS.extend(t for i in pair for t, _ in i.response.said)
    yes('two forms sent in the same moment open one thread, not two',
        len(CH.made) == made + 1)
    yes('and push one copy to the site, not two', len(PUSHED) == pushed + 1)
    yes('and the other is told why, only to them',
        sum(len(i.response.said) for i in pair) == 1
        and all(e for i in pair for _, e in i.response.said))
    yes('and the refused one never started thinking',
        sum(i.response.deferred for i in pair) == 1)

    # ------------------------------------------------------------ staff
    send(G, mo)
    yes('staff with a ticket open, inside the cooldown, still get the form',
        len(pick(G, mo).response.modals) == 1)

    # Content Creator stays on EXTRA_STAFF, the thread auto-add. It is not
    # staff for /close or for the ticket limits. Issue #1324.
    ids, names = bot.EXTRA_STAFF_IDS['creator']
    yes('Content Creator is still on the thread auto-add list',
        'content creator' in bot.EXTRA_STAFF.get('creator', [])
        or 'content creator' in names)
    cam = Person(108, 'Cam', [Role('Content Creator')])
    key = '1:%s' % cam.id
    bot._last_ticket[key] = CLOCK[0]
    cooled = pick(G, cam)
    yes('a Content Creator does not skip the 5 minute cooldown',
        not cooled.response.modals
        and any('only just sent a ticket' in text for text, _ in cooled.response.said))
    bot._last_ticket.pop(key, None)
    send(G, cam)
    bot._last_ticket.pop(key, None)
    held = pick(G, cam)
    yes('a Content Creator does not skip the one open ticket rule',
        not held.response.modals
        and any('already have a ticket open' in text for text, _ in held.response.said))

    import discord

    class TicketThread(discord.Thread):
        # Off the panel's channel, which is what makes it a ticket (#1776).
        parent = CH

        def __init__(self):
            self.edited = []

        async def edit(self, **k):
            self.edited.append(k)

    thread = TicketThread()
    close = Interaction(G, cam)
    close.channel = thread
    asyncio.run(bot.close_here(close))
    yes('a Content Creator cannot /close',
        close.response.said
        and 'Staff close these' in close.response.said[0][0]
        and not thread.edited)


    # -------------------------------------------- and it fails the open way
    #
    # A file somebody broke, or a person the check cannot read, is a person let
    # through. Refusing is the expensive direction to be wrong in.
    with open(bot.OPEN_TICKETS, 'w') as f:
        f.write('this is not json')
    dee = Person(105, 'Dee')
    yes('an unreadable file lets people through',
        len(pick(G, dee).response.modals) == 1)

    LOGGED[:] = []
    odd = pick(G, Broken(106, 'Odd'))
    yes('a check that throws lets them through',
        len(odd.response.modals) == 1 and not odd.response.said)
    yes('and says so in the log', any('let through' in s for s in LOGGED))

    bot.OPEN_TICKETS = os.path.join(TMP, 'no-such-folder', 'open-tickets.json')
    LOGGED[:] = []
    eve = Person(107, 'Eve')
    made = len(CH.made)
    kept = send(G, eve)
    yes('a file that cannot be written still opens the ticket',
        len(CH.made) == made + 1 and len(kept.followup.said) == 1)
    yes('and says so in the log', any('second one' in s for s in LOGGED))
    yes('and the cooldown still holds for that person',
        not pick(G, eve).response.modals)

    # -------------------------------------------------------------- the words
    yes('something was refused, so the words below were checked',
        len(REFUSALS) >= 5)
    yes('no refusal says player',
        not any('player' in t.lower() for t in REFUSALS))
    yes('no refusal has an em dash',
        not any(chr(0x2014) in t for t in REFUSALS))

finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
