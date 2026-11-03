"""
test-trouble.py

The staff-channel line for one session that went wrong, built by
bot._trouble_line out of a row the site wrote to trouble.json.

The thing worth testing is issue #532: a late upload must not read as a fresh
failure. A 401 held Patrick's 23 September logs until 14:09 the next day, when
a newer launcher uploaded the backlog, and the alert fired ~14:10 as if the
crash had just happened. So the line must name the session's OWN start time,
and when the logs arrived well after the session ended it must say so.

_trouble_line is a pure function of the row, so this drives it directly: no
Discord, no clock, no file. The real bot module is imported so a rename or a
reword fails here rather than in the channel.

Then where the line goes (#2940): #staff-updates by its id and nothing else.
No id, or an id the bot cannot see, is a line in the bot log and silence in
Discord, even with a channel called staff-general right there, which is
where it used to fall back to. And the send has every mention off. The
client and the channels are stand-ins that record what would have been sent.

Then when it goes (#3942): with its session's row in trouble.json, which the
site keeps exactly as long as the session's logs, and the posts made before
that, found once in the channel.

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
import datetime

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
import discord  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def ms(year, month, day, hour, minute):
    """Local unix ms, the way the site's Date.now() stamps a row, so it round
    trips through _clock's fromtimestamp whatever this box's timezone is."""
    return int(datetime.datetime(year, month, day, hour, minute).timestamp() * 1000)


# The incident from the issue, to the minute. Started the evening of the 23rd;
# the backlog was refused with 401 and did not land until 14:09 the next day.
start = ms(2026, 9, 23, 20, 7)
end = ms(2026, 9, 23, 21, 30)
arrived = ms(2026, 9, 24, 14, 9)

late = bot._trouble_line({
    'session': 'aaaa', 'name': 'Patrick Thornwood', 'channel': 'dev',
    'version': '1.1.91.10', 'start': start, 'end': end, 'at': arrived,
    'why': 'a script hit a ReferenceError',
    'line': 'ReferenceError: something is not defined',
})

yes('T1 the late alert names the session own start, not now',
    'started 20:07 on 23 September' in late)
yes('T2 and calls out when the logs actually arrived',
    'did not arrive until 14:09 on 24 September' in late)
yes('T3 and says in plain words it is a late upload, not a new failure',
    'late upload rather than a new failure' in late)
yes('T4 it still names who, the build and the launcher version',
    'Patrick Thornwood' in late and 'the dev build' in late
    and 'launcher 1.1.91.10' in late)
yes('T5 and still carries the reason and the line', 'ReferenceError' in late)

# A session whose logs arrive as it ends: the launcher's own end-of-session
# upload, the ordinary case. The start is named; the arrival is not called out,
# because there is nothing late about it.
prompt = bot._trouble_line({
    'session': 'bbbb', 'name': 'Someone', 'channel': 'main',
    'start': ms(2026, 9, 25, 10, 0), 'end': ms(2026, 9, 25, 10, 45),
    'at': ms(2026, 9, 25, 10, 45), 'why': 'the game crashed',
})
yes('T6 a prompt upload still names the session start',
    'started 10:00 on 25 September' in prompt)
yes('T7 and does not call the arrival late', 'did not arrive until' not in prompt)

# An older row, or one whose start was never seen: no start, no arrival, and it
# must not throw. The alert is poorer but still fires.
bare = bot._trouble_line({
    'session': 'cccc', 'who': '123', 'channel': '', 'why': 'the game crashed',
})
yes('T8 a row with no start drops the phrase rather than throwing',
    'It started' not in bare and 'A session went wrong' in bare)
yes('T9 and a row with no arrival gap is not called late',
    'did not arrive until' not in bare)

# _clock itself: the format the whole thing rests on, and its refusal to throw.
yes('T10 _clock reads a stamp as HH:MM on D Month',
    bot._clock(ms(2026, 9, 3, 8, 5)) == '08:05 on 3 September')
yes('T11 _clock gives nothing for a missing, zero or nonsense stamp',
    bot._clock(None) == '' and bot._clock('nope') == '' and bot._clock(0) == '')


# ----------------------------------------------------- where it is said --
SAID = []
bot.log = lambda *a: SAID.append(' '.join(str(x) for x in a))


class Channel(object):
    def __init__(self, cid, name):
        self.id = cid
        self.name = name
        self.sent = []

    async def send(self, text, **kw):
        self.sent.append((text, kw))


class Guild(object):
    def __init__(self, channels):
        self.text_channels = channels


class Client(object):
    def __init__(self, channels):
        self.guilds = [Guild(channels)]
        self.channels = channels

    def get_channel(self, cid):
        for c in self.channels:
            if c.id == cid:
                return c
        return None


def said_with(tid, text='A session went wrong.'):
    """trouble_say against a server with #staff-updates and #staff-general,
       with TROUBLE_ID set to tid. The two channels, and what was logged."""
    updates = Channel(1549254991082946570, 'staff-updates')
    general = Channel(1549254991082946571, 'staff-general')
    keep = bot.client, bot.TROUBLE_ID
    bot.client, bot.TROUBLE_ID = Client([updates, general]), tid
    SAID[:] = []
    try:
        asyncio.run(bot.trouble_say(text))
    finally:
        bot.client, bot.TROUBLE_ID = keep
    return updates, general, list(SAID)


updates, general, said = said_with(1549254991082946570, '@everyone ' + 'x' * 3000)
yes('C1 with the id it speaks in that channel, once',
    len(updates.sent) == 1 and not general.sent)
kw = updates.sent[0][1] if updates.sent else {}
am = kw.get('allowed_mentions')
yes('C2 and with every mention off, so an @everyone in the line pings nobody',
    isinstance(am, discord.AllowedMentions) and not am.everyone
    and not am.users and not am.roles)
yes('C3 and inside Discord\'s length',
    bool(updates.sent) and len(updates.sent[0][0]) <= 1900)

updates, general, said = said_with(0)
yes('C4 with no id nothing is said anywhere, staff-general included',
    not updates.sent and not general.sent)
yes('C5 and the bot log says the id is missing and what sends it',
    any('no channel id' in s and 'staff-channel.txt' in s for s in said))

updates, general, said = said_with(1234)
yes('C6 with an id the bot cannot see nothing is said anywhere either',
    not updates.sent and not general.sent)
yes('C7 and the bot log names that id',
    any('channel 1234 is not one this bot can see' in s for s in said))

# The comments still tell the story; the code holds no such name to look for.
src = harness_bot.source()
yes('C8 bot.py holds no channel name staff-general to fall back to',
    "'staff-general'" not in src and '"staff-general"' not in src)


# ------------------------------------- the post goes when its row goes --
# #3942: every post is written down against its session, and deleted once the
# site has dropped that session's row from trouble.json (365 days, a deletion
# request; a kept session's row stays). The channel and its messages are
# stand-ins; the list is a file in a scratch folder.
import json  # noqa: E402
import tempfile  # noqa: E402

BOT_ID = 4242


class Gone(object):
    status = 404
    reason = 'Not Found'


class Msg(object):
    def __init__(self, ch, mid, content, author=BOT_ID):
        self.channel = ch
        self.id = mid
        self.content = content
        self.author = type('A', (), {'id': author})()

    async def delete(self):
        await self.channel.delete(self.id)


class Room(object):
    """A channel that keeps its messages, sends, deletes and lists them."""
    def __init__(self, cid):
        self.id = cid
        self.name = 'staff-updates'
        self.msgs = {}
        self.next = 9000
        self.refuse = set()

    async def send(self, text, **kw):
        self.next += 1
        m = Msg(self, self.next, text)
        self.msgs[m.id] = m
        return m

    async def delete(self, mid):
        if mid in self.refuse:
            raise RuntimeError('Missing Permissions')
        if mid not in self.msgs:
            raise discord.NotFound(Gone(), 'Unknown Message')
        del self.msgs[mid]

    def get_partial_message(self, mid):
        room = self
        return type('P', (), {'delete': lambda self_: room.delete(mid)})()

    def history(self, limit=None):
        msgs = list(self.msgs.values())

        async def gen():
            for m in msgs:
                yield m
        return gen()


class Bot(object):
    def __init__(self, room):
        self.room = room
        self.user = type('U', (), {'id': BOT_ID})()

    def get_channel(self, cid):
        return self.room if cid == self.room.id else None


def row(sid, name, line):
    return {'session': sid, 'who': '1', 'name': name, 'channel': 'main',
            'start': 0, 'end': 0, 'at': 0, 'why': 'The game crashed',
            'file': 'crash.log', 'line': line}


def run(coro):
    return asyncio.run(coro)


scratch = tempfile.mkdtemp(prefix='thornswood-3942-')
posts = os.path.join(scratch, 'trouble-posts.json')
room = Room(1549254991082946570)
keep = bot.client, bot.TROUBLE_ID
bot.client, bot.TROUBLE_ID = Bot(room), room.id
try:
    a, b = row('s-a', 'Aela', 'EXCEPTION_ACCESS_VIOLATION'), row('s-b', 'Brynjolf', 'Stack overflow')
    for r in (a, b):
        m = run(bot.trouble_say(bot._trouble_line(r)))
        bot.trouble_remember(r['session'], m, posts)
    st = json.load(open(posts, encoding='utf-8'))
    yes('F1 each post is written down against its session',
        sorted(st['posts']) == ['s-a', 's-b'] and len(room.msgs) == 2)
    yes('F2 and what is written down is ids, never what the post said',
        'Aela' not in json.dumps(st) and 'EXCEPTION' not in json.dumps(st))

    got = run(bot.trouble_forget([a, b], posts))
    yes('F3 while both rows are in trouble.json, both posts stay', got == (0, 0) and len(room.msgs) == 2)

    got = run(bot.trouble_forget(None, posts))
    yes('F4 a trouble.json that cannot be read deletes nothing', got == (0, 0) and len(room.msgs) == 2)

    got = run(bot.trouble_forget([b], posts))
    left = [m.content for m in room.msgs.values()]
    yes('F5 a row the site dropped (aged out or a deletion request) takes its post with it',
        got == (1, 0) and len(left) == 1 and 'Brynjolf' in left[0])
    yes('F6 and it is off the list',
        sorted(json.load(open(posts, encoding='utf-8'))['posts']) == ['s-b'])

    bid = list(room.msgs)[0]
    room.refuse.add(bid)
    got = run(bot.trouble_forget([], posts))
    yes('F7 a delete Discord refuses keeps the post on the list for the next pass',
        got == (0, 1) and 's-b' in json.load(open(posts, encoding='utf-8'))['posts'])
    room.refuse.clear()
    del room.msgs[bid]
    got = run(bot.trouble_forget([], posts))
    yes('F8 a post staff already deleted is taken off the list, not retried',
        got == (0, 0) and json.load(open(posts, encoding='utf-8'))['posts'] == {})

    # The posts made before this: nothing written down. One still has its row
    # (in the wording of an older bot), one has lost its row, and beside them
    # a staff notice by the bot and somebody's own message.
    posts2 = os.path.join(scratch, 'trouble-posts-2.json')
    room.msgs.clear()
    c, d = row('s-c', 'Cicero', 'Papyrus stack dump'), row('s-d', 'Delphine', 'out of memory')
    oldc = Msg(room, 1, bot.TROUBLE_HEAD + ' Cicero, on the main build.\nThe game crashed\n```\nPapyrus stack dump\n```\nOld wording.')
    oldd = Msg(room, 2, bot._trouble_line(d))
    note = Msg(room, 3, '[claude] Restarting the dev server at 4:30 PM.')
    theirs = Msg(room, 4, bot.TROUBLE_HEAD + ' somebody pasting it', author=7)
    for m in (oldc, oldd, note, theirs):
        room.msgs[m.id] = m
    got = run(bot.trouble_backfill([c], posts2))
    st = json.load(open(posts2, encoding='utf-8'))
    yes('B1 an old post whose row is gone is deleted', got == (1, 0) and 2 not in room.msgs)
    yes('B2 an old post whose row is still there is written down, in older wording too',
        1 in room.msgs and st['posts'].get('s-c', {}).get('message') == 1)
    yes('B3 a staff notice and anybody else\'s message are never touched', 3 in room.msgs and 4 in room.msgs)
    yes('B4 the look is done once', st.get('backfilled') is True)
    room.msgs[5] = Msg(room, 5, bot._trouble_line(d))
    run(bot.trouble_backfill([c], posts2))
    yes('B5 and not again', 5 in room.msgs)
    got = run(bot.trouble_forget([], posts2))
    yes('B6 an old post written down goes when its row goes, like a new one', got == (1, 0) and 1 not in room.msgs)
finally:
    bot.client, bot.TROUBLE_ID = keep

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
