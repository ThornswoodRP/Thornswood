"""
test-reports.py

The report watcher in bot.py: what somebody sends in on the site's public
report page is said in the staff channel the day it arrives.

The page tells a stranger "Somebody will read it", and until this the only
place it could be read was the inbox on the hub. So the things worth checking
are that a new report is said once, that a ticket is not said at all (its
thread in Discord is already where staff read it), that a flood is one line
rather than a channel nobody can read, that a file caught half written is not
taken for an empty one, and that nothing a stranger typed can ping anybody.

The real bot module is imported and the real coroutine is run over a real file
in a temp folder. Only the Discord send, the channel lookup and the sleep are
replaced.

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

import discord  # noqa: E402
import harness_bot  # noqa: E402
bot = harness_bot.whole()
PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


class Stop(BaseException):
    """Ends the loop. BaseException, because the loop catches Exception."""


class AsyncioShim(object):
    """Everything asyncio does, except sleeping. Only what bot.py looks up."""

    def __init__(self, on_sleep):
        self._on_sleep = on_sleep

    def __getattr__(self, name):
        return getattr(asyncio, name)

    async def sleep(self, seconds):
        return self._on_sleep(seconds)


class FakeClient(object):
    guilds = []

    async def wait_until_ready(self):
        return None

    def is_closed(self):
        return False


WORK = tempfile.mkdtemp(prefix='thornswood-reports-')
FILE = os.path.join(WORK, 'inbox.json')

MISSING = object()


def put(content):
    """A list is written as JSON, a string as it is, MISSING removes it."""
    if content is MISSING:
        if os.path.exists(FILE):
            os.remove(FILE)
        return
    with open(FILE, 'w', encoding='utf-8') as f:
        f.write(content if isinstance(content, str) else json.dumps(content))


def report(i, kind='bug', **more):
    row = {'id': 'r%d' % i, 'kind': kind, 'title': 'report %d' % i,
           'detail': '', 'by': '', 'from': 'the public page'}
    row.update(more)
    return row


def ticket(i):
    return {'id': 't%d' % i, 'kind': 'ticket', 'title': 'ticket %d' % i,
            'from': 'the Discord bot'}


def drive(start, steps):
    """
    Run watch_reports over a file that starts as `start` and becomes each of
    `steps` in turn, one per sleep. Returns (seconds slept, what was said
    before that sleep) for every sleep.
    """
    put(start)
    said = []
    ticks = []
    state = {'i': 0}

    async def fake_say(text):
        said.append(text)

    def on_sleep(seconds):
        ticks.append((seconds, list(said)))
        del said[:]
        if state['i'] >= len(steps):
            raise Stop()
        put(steps[state['i']])
        state['i'] += 1

    keep = (bot.REPORTS_FILE, bot.report_say, bot.client, bot._trouble_channel,
            bot.asyncio)
    bot.REPORTS_FILE = FILE
    bot.report_say = fake_say
    bot.client = FakeClient()
    bot._trouble_channel = lambda: None
    bot.asyncio = AsyncioShim(on_sleep)
    try:
        try:
            asyncio.run(bot.watch_reports())
        except Stop:
            pass
    finally:
        (bot.REPORTS_FILE, bot.report_say, bot.client, bot._trouble_channel,
         bot.asyncio) = keep
    return ticks


HAS = all(hasattr(bot, n) for n in
          ('watch_reports', 'report_say', 'report_text', 'REPORTS_FILE',
           'REPORTS_EVERY'))
yes('bot.py has a report watcher to test', HAS)
if not HAS:
    shutil.rmtree(WORK, ignore_errors=True)
    print('')
    print('%d passed, %d failed' % (len(PASS), len(FAIL)))
    sys.exit(1)

try:
    EVERY = bot.REPORTS_EVERY

    # R1: what is already there when the bot starts is treated as said, so a
    #     restart is not the last two thousand reports all over again.
    first = [report(2), report(1), ticket(1)]
    ticks = drive(first, [first, first])
    yes('R1 nothing already in the file is said on start',
        all(s == [] for _, s in ticks))
    yes('R1 and it looks again every REPORTS_EVERY seconds',
        [t for t, _ in ticks] == [EVERY, EVERY, EVERY])

    # R2: a new report is said once, and a new ticket is not said at all.
    later = [report(3), ticket(2)] + first
    ticks = drive(first, [later, later, later])
    said = [s for _, s in ticks]
    yes('R2 a new report is said', len(said[1]) == 1 and 'report 3' in said[1][0])
    yes('R2 exactly once, however many looks follow',
        sum(len(s) for s in said) == 1)
    yes('R2 and the new ticket in the same look is not',
        not any('ticket 2' in t for s in said for t in s))

    # R3: two at once are both said, oldest first, which is how a channel is
    #     read.
    two = [report(5), report(4)] + first
    ticks = drive(first, [two])
    got = ticks[1][1]
    yes('R3 two new reports are two lines', len(got) == 2)
    yes('R3 oldest first', len(got) == 2 and 'report 4' in got[0] and 'report 5' in got[1])

    # R4: more than five in one look is a script, because the site takes five
    #     an hour from any one place. One line, not a wall of them.
    flood = [report(100 + i) for i in range(7)] + first
    ticks = drive(first, [flood, flood])
    got = ticks[1][1]
    yes('R4 seven at once is one line', len(got) == 1)
    yes('R4 which says how many', len(got) == 1 and '7 reports' in got[0])
    yes('R4 and none of them come back on the next look', ticks[2][1] == [])
    ticks = drive(first, [[report(200 + i) for i in range(5)] + first])
    yes('R4 five at once are still said one by one', len(ticks[1][1]) == 5)

    # R5: a file caught half written is not an empty file. Read as empty it
    #     would make every row new on the next look.
    ticks = drive(first, ['[{"id": "r9", "kin', later])
    said = [s for _, s in ticks]
    yes('R5 a file that will not parse says nothing', said[1] == [])
    yes('R5 and the look after it says only what is actually new',
        sum(len(s) for s in said) == 1 and 'report 3' in said[2][0])

    # R6: the same at startup. The bot waits for a file it can read rather
    #     than starting from nothing and announcing everything in it.
    ticks = drive('{half', [first, first])
    yes('R6 a file that will not parse at start is waited out',
        ticks[0][0] == 5)
    yes('R6 and what was in it once it parsed is treated as said',
        all(s == [] for _, s in ticks))

    # R7: no file at all is a site that has never had a report, and the first
    #     one is said.
    ticks = drive(MISSING, [[report(1)]])
    yes('R7 no file at start is not waited on', ticks[0][0] == EVERY)
    yes('R7 and the first report after it is said',
        len(ticks[1][1]) == 1 and 'report 1' in ticks[1][1][0])

    # R8: rubbish rows are skipped rather than ending the loop.
    ticks = drive(first, [['a string', None, {'kind': 'bug'}, report(6)] + first,
                          [report(7), report(6)] + first])
    said = [s for _, s in ticks]
    yes('R8 rows with no id are skipped and the real one is said',
        len(said[1]) == 1 and 'report 6' in said[1][0])
    yes('R8 and the loop is still going after them',
        len(said[2]) == 1 and 'report 7' in said[2][0])

    # R9: what a stranger typed cannot ping anybody or dress itself up.
    text = bot.report_text(report(1, kind='idea', title='@everyone look here',
                                  by='[staff](http://example.invalid)',
                                  detail='**urgent** ' + 'x' * 1000))
    yes('R9 an @everyone in a title is text, not a ping',
        '@everyone' not in text and '@\u200beveryone' in text)
    yes('R9 a masked link is shown as what it is',
        '\\[staff](http://example.invalid)' in text)
    yes('R9 bold in the detail is escaped', '\\*\\*urgent\\*\\*' in text)
    yes('R9 the detail is cut at 400 characters', text.count('x') < 420)
    yes('R9 an idea says it is an idea', 'An idea' in text)
    yes('R9 and a bug says it is a problem',
        'A problem' in bot.report_text(report(1)))
    yes('R9 no name left is said plainly',
        'with no name left' in bot.report_text(report(1)))
    for w in (text, bot.report_text(report(1))):
        if 'player' in w.lower() or '\u2014' in w:
            yes('R9 the words are the site\'s words', False)
            break
    else:
        yes('R9 the words are the site\'s words', True)

    # R10: and the send itself switches every mention off, so even a real id
    #      typed into a report pings nobody.
    sent = []

    class Channel(object):
        name = 'staff-general'

        async def send(self, text, **kw):
            sent.append((text, kw))

    keep = bot._trouble_channel
    bot._trouble_channel = lambda: Channel()
    try:
        asyncio.run(bot.report_say('x' * 3000))
    finally:
        bot._trouble_channel = keep
    kw = sent[0][1] if sent else {}
    am = kw.get('allowed_mentions')
    yes('R10 report_say sends with mentions switched off',
        isinstance(am, discord.AllowedMentions) and not am.everyone
        and not am.users and not am.roles)
    yes('R10 and link previews off', kw.get('suppress_embeds') is True)
    yes('R10 and inside Discord\'s length', sent and len(sent[0][0]) <= 1900)

    before = len(sent)
    bot._trouble_channel = lambda: None
    try:
        asyncio.run(bot.report_say('nowhere to go'))
    finally:
        bot._trouble_channel = keep
    yes('R10 no staff channel is silence, not a fallback', len(sent) == before)

    # R12 (#414): a call for help and a report from inside the game, and a
    #      report about a person from the site, each say what they are.
    helprow = report(1, kind='help', by='Aela', title='stuck in a rock',
                     detail='At Whiterun. Profile 7: a claim, not proof.',
                     **{'from': 'in game'})
    t = bot.report_text(helprow)
    yes('R12 a call for help from the game says who asked, in game',
        'Aela asked for help in game' in t and 'stuck in a rock' in t
        and 'a claim, not proof' in t)
    t = bot.report_text(report(1, kind='report', by='Aela', about='@here Brynjolf',
                               title='stole from my stall',
                               **{'from': 'in game on the dev server'}))
    yes('R12 a report from the dev server names who and says dev',
        'Aela reported' in t and 'Brynjolf' in t and 'on the dev server' in t)
    yes('R12 and a name typed as a ping is text', '@here' not in t)
    t = bot.report_text(report(1, kind='report', by='Aela', about='Brynjolf',
                               title='harassing people', discordId='123456',
                               **{'from': 'the public page, signed in'}))
    yes('R12 a report from the site names the account that sent it',
        'Aela reported Brynjolf on the site' in t and '<@123456>' in t)
    for w in (bot.report_text(helprow), t):
        if 'player' in w.lower() or '—' in w:
            yes('R12 the words are the site\'s words', False)
            break
    else:
        yes('R12 the words are the site\'s words', True)
    later2 = [report(8, kind='help', **{'from': 'in game'})] + first
    ticks = drive(first, [later2])
    yes('R12 and the watcher says a call for help like any other report',
        len(ticks[1][1]) == 1 and 'asked for help in game' in ticks[1][1][0])

    # R11: it is started with the other watchers, once.
    import inspect  # noqa: E402
    src = inspect.getsource(bot.on_ready)
    yes('R11 on_ready starts it beside watch_trouble',
        'asyncio.create_task(watch_reports())' in src
        and src.index('watch_trouble()') < src.index('watch_reports()'))
    yes('R11 and by default it reads the inbox beside trouble.json',
        os.path.dirname(bot.REPORTS_FILE) == os.path.dirname(bot.TROUBLE_FILE)
        or 'REPORTS_FILE' in os.environ)
finally:
    shutil.rmtree(WORK, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
