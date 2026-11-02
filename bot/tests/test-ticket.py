"""
test-ticket.py

Somebody who presses Submit on a ticket hears back as soon as the ticket
exists in Discord, and the copy for the site goes after it without anybody
waiting on it.

From the To Do List, entry 253: "Acknowledge as soon as the thing they asked
for exists and do the bookkeeping afterwards. A spinner that sits for ten
seconds reads as broken to somebody who has never used the server, and the
site copy still lands."

The push to the site is urlopen with a twelve second timeout. It was awaited
before the reply, so with the site down a stranger pressing Submit watched the
bot think for twelve seconds before being told their ticket was open.

The real bot module is imported and the real TicketModal.on_submit is run.
Discord is replaced by small fakes that write down what happened and in what
order, and the push to the site is held open until the test lets it go. So the
order is measured rather than timed: on the code before the fix, the reply
cannot come until the held push gives up, and every order check below fails.

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
import threading
import urllib.error
import urllib.request

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


# How long a held push waits for the test before giving up on its own. Only
# the code before the fix ever reaches it, because only that code waits on the
# push before replying, so this is how long each failing case takes to fail.
HOLD = 2.0

ANSWERS = ['It will not connect', 'Launching it from the desktop',
           'Connection refused']


class Answer(object):
    """What a TextInput looks like to on_submit: something with a value."""

    def __init__(self, value):
        self.value = value


class Perms(object):
    """
    Everything thread_block asks about, all allowed.

    Managing threads is not. The person sending is a newcomer, and the one
    ticket at a time limit applies to them as it would to anybody. is_staff
    reads only their roles since #1342, so this would not make them staff
    either way.
    """
    view_channel = True
    send_messages = True
    create_private_threads = True
    send_messages_in_threads = True
    manage_threads = False


class Member(object):
    def __init__(self, mid, name, events=None, is_bot=False):
        self.id = mid
        self.name = name
        self.display_name = name.capitalize()
        self.mention = '<@%d>' % mid
        self.bot = is_bot
        self.events = events
        self.dms = []

    def __str__(self):
        return self.name

    async def send(self, text):
        await asyncio.sleep(0)
        self.dms.append(text)
        self.events.append('direct message')


class Role(object):
    def __init__(self, name, members):
        self.name = name
        self.mention = '<@&%s>' % name
        self.members = members


class Thread(object):
    def __init__(self, events):
        self.events = events
        self.id = 900
        self.mention = '<#900>'
        self.sent = []
        self.added = []

    async def add_user(self, m):
        await asyncio.sleep(0)
        self.added.append(m)

    async def send(self, text, view=None, **kw):
        await asyncio.sleep(0)
        self.sent.append(text)
        self.events.append('written in the thread')


class Channel(object):
    """The panel's channel, which everybody in the server can read."""
    said = 'written in the panel channel'

    def __init__(self, name, events, refuse_thread=False):
        self.name = name
        self.events = events
        self.refuse_thread = refuse_thread
        self.sent = []
        self.thread = None

    def permissions_for(self, _me):
        return Perms()

    async def create_thread(self, **_kw):
        await asyncio.sleep(0)
        if self.refuse_thread:
            raise RuntimeError('403 Forbidden (error code: 50013): '
                               'Missing Permissions')
        self.thread = Thread(self.events)
        return self.thread

    async def send(self, text, **kw):
        await asyncio.sleep(0)
        self.sent.append(text)
        self.events.append(self.said)


class Seen(object):
    def __init__(self, view_channel):
        self.view_channel = view_channel


class StaffChannel(Channel):
    """
    The staff only log channel a ticket goes to when its thread will not open.
    Only the bot can see it among the things log_channel asks about, because
    the one role here is staff and staff are not asked.
    """
    said = 'written in the staff channel'

    def permissions_for(self, who):
        return Seen(bool(getattr(who, 'bot', False)))


class NoManage(object):
    """The bot cannot make channels, so a missing log channel stays missing."""
    manage_channels = False


class Guild(object):
    def __init__(self, channels, roles):
        self.id = 7
        self.text_channels = channels
        self.voice_channels = []
        self.default_role = Role('@everyone', [])
        self.roles = [self.default_role] + roles
        self.me = Member(1, 'thornswood', is_bot=True)
        self.me.guild_permissions = NoManage()

    def get_thread(self, tid):
        for ch in self.text_channels:
            if ch.thread is not None and ch.thread.id == tid:
                return ch.thread
        return None


class Response(object):
    def __init__(self, events):
        self.events = events

    async def defer(self, ephemeral=False, thinking=False):
        self.events.append('deferred')


class Followup(object):
    def __init__(self, events, refuse):
        self.events = events
        self.refuse = refuse
        self.said = []

    async def send(self, text, ephemeral=False):
        await asyncio.sleep(0)
        if self.refuse:
            raise RuntimeError('404 Not Found (error code: 10015): '
                               'Unknown Webhook')
        self.said.append((text, ephemeral))
        self.events.append('acknowledged')


class Interaction(object):
    def __init__(self, guild, user, events, refuse_reply):
        self.guild = guild
        self.user = user
        # The panel's channel, which is where the form was sent from.
        self.channel = guild.text_channels[0] if guild.text_channels else None
        self.response = Response(events)
        self.followup = Followup(events, refuse_reply)


def held_push(gate, events, calls):
    """bot.push, standing in for a site that takes its time."""
    def fake(*a):
        calls.append(a)
        events.append('site push starts')
        gate.wait(HOLD)
        events.append('site push finished')
    return fake


def unreachable(gate, events, seen):
    """urlopen, standing in for a site that never answers."""
    def fake(req, timeout=None):
        seen.append((req.full_url, timeout))
        events.append('site push starts')
        gate.wait(HOLD)
        events.append('site push finished')
        raise urllib.error.URLError('timed out')
    return fake


# on_submit asks the one ticket at a time limit before anything else
# (test-tickets.py is where that limit is tested). Every case here is somebody
# with nothing open who has not sent a ticket lately, so the limit lets them
# through by its own check. Before the fakes above answered what it asks, it
# let them through by failing, which proved nothing, and every case after the
# first would have been refused as too soon the day that check stopped
# failing. The file of open tickets goes in a temporary folder so this never
# touches the one beside the code.
TMP = tempfile.mkdtemp(prefix='thornswood-ticket-')
bot.OPEN_TICKETS = os.path.join(TMP, 'open-tickets.json')
ALL_LINES = []


def submit(where, refuse_reply=False, real_push=False):
    """
    One ticket, from Submit to the site copy landing.

    where is 'thread' (the thread opens), 'channel' (the thread is refused, so
    it falls back to the staff only log channel) or 'nowhere' (no tickets
    channel and no staff channel at all, so the person is sent a message).
    Returns everything that was recorded.
    """
    out = {'events': [], 'calls': [], 'seen': [], 'lines': [],
           'raised': None, 'in_flight': None, 'left': None, 'stored': None}
    events = out['events']
    gate = threading.Event()

    # Nothing open and nothing sent lately, whatever the case before did.
    bot._last_ticket.clear()
    if os.path.exists(bot.OPEN_TICKETS):
        os.remove(bot.OPEN_TICKETS)

    async def go():
        staff = Member(3, 'moderator')
        who = Member(42, 'ada', events)
        channels = []
        if where != 'nowhere':
            channels.append(Channel(bot.TICKETS[0], events,
                                    refuse_thread=(where == 'channel')))
            channels.append(StaffChannel(bot.TICKET_LOG[0], events))
        guild = Guild(channels, [Role('Moderator', [staff])])
        inter = Interaction(guild, who, events, refuse_reply)
        out['who'] = who
        out['channel'] = channels[0] if channels else None
        out['staff'] = channels[1] if channels else None
        out['followup'] = inter.followup

        keep = (bot.push, bot.log, bot.KEY, urllib.request.urlopen)
        bot.log = lambda *a: out['lines'].append(' '.join(str(x) for x in a))
        if real_push:
            # The real push, with only the network underneath it replaced. A
            # key that is not a real one, because push says nothing and sends
            # nothing without one.
            bot.KEY = 'not-a-real-key'
            urllib.request.urlopen = unreachable(gate, events, out['seen'])
        else:
            bot.push = held_push(gate, events, out['calls'])
        try:
            modal = bot.TicketModal('help', 'I need help')
            modal.fields = [Answer(v) for v in ANSWERS]
            try:
                await modal.on_submit(inter)
            except Exception as e:
                out['raised'] = e
            events.append('on_submit returned')
            out['in_flight'] = len(getattr(bot, '_pushes', ()))
            try:
                with open(bot.OPEN_TICKETS) as f:
                    out['stored'] = json.load(f)
            except Exception:
                out['stored'] = None

            # Now let the site answer, and wait for the copy to land.
            gate.set()
            pending = list(getattr(bot, '_pushes', ()))
            if pending:
                await asyncio.gather(*pending)
            await asyncio.sleep(0)
            out['left'] = len(getattr(bot, '_pushes', ()))
        finally:
            gate.set()
            (bot.push, bot.log, bot.KEY, urllib.request.urlopen) = keep

    asyncio.run(go())
    ALL_LINES.extend(out['lines'])
    return out


def before(events, a, b):
    """Whether a happened, b happened, and a came first."""
    return a in events and b in events and events.index(a) < events.index(b)


def pushed_once(r):
    c = r['calls']
    return (len(c) == 1 and c[0][0] == 'help' and c[0][1] == 'I need help: Ada'
            and ANSWERS[0] in c[0][2] and c[0][3] == 'ada' and c[0][4] == 42)


# T1: THE ONE THIS IS FOR. The thread opens, and the person is told so while
#     the site is still thinking about it.
r = submit('thread')
ev = r['events']
yes('T1 the handler is deferred first, so Discord\'s three seconds are met',
    ev[:1] == ['deferred'])
yes('T1 the ticket is written in its thread before anybody is told it exists',
    before(ev, 'written in the thread', 'acknowledged'))
yes('T1 THE REPLY GOES OUT BEFORE THE SITE HAS ANSWERED',
    before(ev, 'acknowledged', 'site push finished'))
yes('T1 and on_submit is finished while the push is still going',
    before(ev, 'on_submit returned', 'site push finished'))
yes('T1 the reply names the thread',
    r['followup'].said
    and r['followup'].said[0] == ('Opened <#900>. Everything else goes in there.', True))
yes('T1 the site copy still goes, once, with the same five things as before',
    pushed_once(r))
yes('T1 and it is the same ticket the thread holds',
    r['calls'] and r['channel'].thread
    and r['calls'][0][2] in r['channel'].thread.sent)
yes('T1 the push in flight is held on to, so it cannot be collected half done',
    r['in_flight'] == 1)
yes('T1 and it lets go of it once the copy has landed', r['left'] == 0)
yes('T1 nothing raised', r['raised'] is None)
yes('T1 the thread is written down as their one open ticket',
    r['stored'] == {'7:42': 900})

# T2: the thread is refused, so the ticket goes to the staff only log channel
#     instead (test-ticket-fallback.py is where that fallback is tested). Same
#     answer: told as soon as it is there, not when the site has had its say.
r = submit('channel')
ev = r['events']
yes('T2 the ticket is in the staff channel before anybody is told it exists',
    before(ev, 'written in the staff channel', 'acknowledged'))
yes('T2 and none of it went into the panel channel, which everybody can read',
    r['channel'].sent == [])
yes('T2 THE REPLY GOES OUT BEFORE THE SITE HAS ANSWERED',
    before(ev, 'acknowledged', 'site push finished'))
yes('T2 the reply says it went to staff, somewhere only staff can read it',
    r['followup'].said
    and r['followup'].said[0][0].startswith('Sent. A private thread would not open')
    and 'only staff can read' in r['followup'].said[0][0])
yes('T2 the site copy still goes, once', pushed_once(r))
yes('T2 nothing raised', r['raised'] is None)

# T3: no tickets channel and no staff channel at all. The person gets a
#     message, then the reply.
r = submit('nowhere')
ev = r['events']
yes('T3 the direct message goes before the reply',
    before(ev, 'direct message', 'acknowledged'))
yes('T3 THE REPLY GOES OUT BEFORE THE SITE HAS ANSWERED',
    before(ev, 'acknowledged', 'site push finished'))
yes('T3 the reply says the answer comes by message',
    r['followup'].said
    and r['followup'].said[0][0].startswith('Sent to staff.'))
yes('T3 the site copy still goes, once', pushed_once(r))

# T4: Discord refuses the reply itself. The site copy was the one place this
#     ticket reached before the reply was tried, and it must still get there.
#     This is why the push is started ahead of the replies and not after them:
#     after them, an exception here would have skipped it.
r = submit('thread', refuse_reply=True)
yes('T4 a refused reply is not swallowed, so discord.py still logs it',
    r['raised'] is not None)
yes('T4 and the site copy still goes, once', pushed_once(r))
yes('T4 and it finishes', 'site push finished' in r['events'])

# T5: the done-when on the To Do List. The real push, with the site not
#     answering: the reply is there at once, and the log still carries "site
#     push failed", which is what proves the push ran and reported.
r = submit('thread', real_push=True)
ev = r['events']
yes('T5 THE REPLY GOES OUT BEFORE THE UNREACHABLE SITE GIVES UP',
    before(ev, 'acknowledged', 'site push finished'))
yes('T5 the push really went to the site\'s ticket address, with its timeout',
    r['seen'] == [(bot.SITE + '/api/ticket', 12)])
yes('T5 and its failure is still written in the log',
    any(line.startswith('site push failed:') for line in r['lines']))
yes('T5 nothing raised into the handler', r['raised'] is None)
yes('T5 and nothing is left in flight', r['left'] == 0)

# Every case above reached the ticket through the limit's own check, not past
# it because the check fell over.
yes('every case was let through by the ticket limit, none by its failing',
    not any(line.startswith('the ticket limit could not be checked')
            for line in ALL_LINES))
yes('and no open ticket failed to be written down',
    not any(line.startswith('could not write down which ticket')
            for line in ALL_LINES))
# The same for the staff channel: found or not found by log_channel's own
# checks, never missed because a fake could not answer what it asked.
yes('and the staff channel was looked for without anything falling over',
    not any(line.startswith('could not look for the staff only log channel')
            or line.startswith('could not read the permissions on')
            for line in ALL_LINES))

shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
