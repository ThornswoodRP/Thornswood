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
that, found once in the channel. A post in a channel Discord says is gone
goes off the list, and one in a channel out of reach stays and is said once
(#4944).

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
    """A fixed instant, independent of the machine running the harness."""
    return int(datetime.datetime(year, month, day, hour, minute,
               tzinfo=datetime.timezone.utc).timestamp() * 1000)


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
    'started 20:07 UTC on 23 September 2026' in late)
yes('T2 and calls out when the logs actually arrived',
    'did not arrive until 14:09 UTC on 24 September 2026' in late)
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
    'started 10:00 UTC on 25 September 2026' in prompt)
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
yes('T10 _clock names its UTC zone and year',
    bot._clock(ms(2026, 9, 3, 8, 5)) == '08:05 UTC on 3 September 2026')
yes('T11 _clock gives nothing for a missing, zero or nonsense stamp',
    bot._clock(None) == '' and bot._clock('nope') == '' and bot._clock(0) == '')
yes('T12 both repeated autumn hours remain distinct UTC instants',
    bot._clock(ms(2026, 11, 1, 7, 30)) == '07:30 UTC on 1 November 2026'
    and bot._clock(ms(2026, 11, 1, 8, 30)) == '08:30 UTC on 1 November 2026')


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


class NoAccess(object):
    status = 403
    reason = 'Forbidden'


class Bot(object):
    def __init__(self, room):
        self.room = room
        self.user = type('U', (), {'id': BOT_ID})()
        self.fetched = []
        self.hidden = set()
        self.back = set()

    def get_channel(self, cid):
        return self.room if cid == self.room.id else None

    async def fetch_channel(self, cid):
        # A channel the cache misses (#4944): one Discord has deleted is
        # NotFound, one the bot may not see is Forbidden, and one that comes
        # back into reach is the room.
        self.fetched.append(cid)
        if cid in self.back:
            return self.room
        if cid in self.hidden:
            raise discord.Forbidden(NoAccess(), 'Missing Access')
        raise discord.NotFound(Gone(), 'Unknown Channel')


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

    # A post in a channel that is gone, or out of reach (#4944). get_channel
    # misses both, which used to keep the post forever and log a line every
    # pass (every 120 s).
    said = []
    keep_log = bot.log
    bot.log = lambda *a: said.append(' '.join(str(x) for x in a))
    try:
        posts3 = os.path.join(scratch, 'trouble-posts-3.json')
        GONE, HIDDEN = 7001, 7002
        bot.client.hidden.add(HIDDEN)
        json.dump({'posts': {'s-gone': {'channel': GONE, 'message': 11},
                             's-gone-2': {'channel': GONE, 'message': 12},
                             's-hid': {'channel': HIDDEN, 'message': 21},
                             's-hid-2': {'channel': HIDDEN, 'message': 22}}},
                  open(posts3, 'w', encoding='utf-8'))
        got = run(bot.trouble_forget([], posts3))
        left = json.load(open(posts3, encoding='utf-8'))['posts']
        yes('G1 a channel Discord says is gone takes its posts off the list', 's-gone' not in left and 's-gone-2' not in left)
        yes('G2 a channel only out of reach keeps its posts for the next pass', sorted(left) == ['s-hid', 's-hid-2'] and got == (0, 2))
        yes('G3 Discord is asked about each channel once a pass, not once a post',
            sorted(bot.client.fetched) == [GONE, HIDDEN])
        out_of_reach = [l for l in said if str(HIDDEN) in l]
        yes('G4 the channel out of reach is said once, with Discord\'s reason',
            len(out_of_reach) == 1 and 'Forbidden' in out_of_reach[0])
        for n in range(3):
            got = run(bot.trouble_forget([], posts3))
        yes('G5 and not again on the passes after it, while its posts stay',
            len([l for l in said if str(HIDDEN) in l]) == 1 and got == (0, 2)
            and sorted(json.load(open(posts3, encoding='utf-8'))['posts']) == ['s-hid', 's-hid-2'])
        yes('G6 the gone channel is not asked about again: its posts are off the list',
            bot.client.fetched.count(GONE) == 1)
        # Back in reach: the posts are deleted (already gone from the room, so
        # taken off the list), and that it is in reach again is said.
        bot.client.back.add(HIDDEN)
        got = run(bot.trouble_forget([], posts3))
        yes('G7 a channel back in reach has its posts dealt with, and says so',
            json.load(open(posts3, encoding='utf-8'))['posts'] == {}
            and any('in reach again' in l and str(HIDDEN) in l for l in said))
        yes('G8 no line names what a post said, only ids', not any('Aela' in l or 'Brynjolf' in l for l in said))
    finally:
        bot.log = keep_log
finally:
    bot.client, bot.TROUBLE_ID = keep

# ------------------------------------------- outside text stays text --
# #4281: the name, version and reason come from the site's row and the line
# from somebody's crash.log. They went into the post as they were, so a line
# holding three backticks closed its code block and the rest rendered as
# markdown, and a masked link in the reason or the name was a link.
class Kept(Room):
    """A Room that keeps what each send was given, not only its text."""
    def __init__(self, cid):
        Room.__init__(self, cid)
        self.kw = []

    async def send(self, text, **kw):
        self.kw.append(kw)
        return await Room.send(self, text, **kw)


evil = {'session': 's-e', 'who': '2', 'name': 'Ae_la [me](https://evil.example)',
        'channel': 'main', 'start': 0, 'end': 0, 'at': 0, 'version': '1.3.*9*',
        'why': 'The game crashed, see [the fix](https://evil.example/x) @everyone',
        'file': 'crash.log', 'line': 'EXCEPTION ```\n**now bold** [here](https://evil.example/y)'}
text = bot._trouble_line(evil)
yes('E1 a log line holding three backticks cannot close its code block: the post has its own two fences and no more',
    text.count('```') == 2)
inside = text.split('```')[1] if text.count('```') >= 2 else ''
yes('E2 and the whole line, its backticks too, is inside that block',
    'EXCEPTION' in inside and 'now bold' in inside and 'here' in inside
    and inside.count('`') == 3)
outside = text.split('```')[0] + (text.split('```')[2] if text.count('```') >= 2 else '')
yes('E3 a masked link in the name or the reason is shown as typed, never a link',
    '[me](' not in outside.replace('\\[me](', '') and '[the fix](' not in outside.replace('\\[the fix](', ''))
yes('E4 markdown in the name and the version is shown as typed',
    'Ae\\_la' in outside and '1.3.\\*9\\*' in outside)
yes('E5 an @everyone in the reason is text', '@everyone' not in outside)

kept = Kept(1549254991082946570)
keep = bot.client, bot.TROUBLE_ID
bot.client, bot.TROUBLE_ID = Bot(kept), kept.id
try:
    run(bot.trouble_say(text))
    state = {}
    sent = run(bot.send_copy(os.path.join(scratch, 'trouble-posts-4281.json'), state, 'posts',
                             ['s-e'], text, bot.client))
finally:
    bot.client, bot.TROUBLE_ID = keep
for name, kw in zip(('trouble_say', 'the post watch_trouble makes'), kept.kw):
    am = kw.get('allowed_mentions')
    yes('E6 %s sends with every mention off and link previews suppressed' % name,
        isinstance(am, discord.AllowedMentions) and not am.everyone and not am.users
        and not am.roles and kw.get('suppress_embeds') is True)
yes('E7 both sends were made', len(kept.kw) == 2 and sent is True)

# A post made before this change has the row's text as it was. The one-time
# look for old posts must still find it, and a post made now too.
plain = row('s-o', 'Ser_ana', 'bad ``` line')
old = (bot.TROUBLE_HEAD + ' Ser_ana, on the main build.\nThe game crashed\n'
       '```\nbad ``` line\n```\nThe logs are on the sessions page under that '
       'session, and it is the red one.')
yes('E8 an old-format post, the name and line as they were, still matches its row',
    bot._trouble_post_matches(old, plain))
yes('E9 and a post made now matches it too', bot._trouble_post_matches(bot._trouble_line(plain), plain))
yes('E10 and neither matches somebody else\'s row',
    not bot._trouble_post_matches(old, row('s-p', 'Delphine', 'bad ``` line'))
    and not bot._trouble_post_matches(bot._trouble_line(plain), row('s-p', 'Ser_ana', 'other line')))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
