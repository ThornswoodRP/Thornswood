"""
test-watch-services.py

The bot saying in the staff channel what the VPS watchdog says has died, and
when it is back (issue #447).

Since #447 the watchdog decides: one message when a thing goes down, one when
it is back, however long it stays down and however often it flaps. It writes
them to alerts.jsonl, and tests\\test-watch-alerts.ps1 proves the counting.
The bot only delivers, so what is worth testing here is that it delivers each
message ONCE: not again on its next read, not again after a restart, not again
after the watchdog's webhook said it while the bot was down, and not a day
late. And that it never says anything anywhere but the staff channel, found by
id: this server has a public channel with the same name.

The outbox it reads here is one the real watchdog wrote: this runs
test-watch-alerts.ps1 -Emit, which drives the watcher out of
Watch-Services.ps1 against fakes, so a change to the shape of a message on
either side fails here rather than going quiet on the box.

The real bot module is imported and the real coroutine is run against real
files in a temporary folder. Only Discord and the sleep are replaced.

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
import subprocess
import tempfile
import time

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def done():
    print('')
    print('%d passed, %d failed' % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)


yes('bot.py reads the watchdog\'s outbox',
    hasattr(bot, 'watch_alerts_due') and hasattr(bot, 'watch_services')
    and hasattr(bot, '_watch_lines') and hasattr(bot, 'WATCH_ALERTS'))
if FAIL:
    done()

yes('W1 the outbox and the two lists are the files the watchdog names',
    os.path.basename(bot.WATCH_ALERTS) == 'alerts.jsonl'
    and os.path.basename(bot.WATCH_SENT_BOT) == 'alerts-sent-bot.txt'
    and os.path.basename(bot.WATCH_SENT_HOOK) == 'alerts-sent-webhook.txt'
    and bot.WATCH_DIR == r'C:\Thornswood-Watch')
PS1 = open(os.path.join(HERE, '..', 'scripts', 'vps', 'Watch-Services.ps1'),
           encoding='utf-8').read()
yes('W1 and Watch-Services.ps1 writes those same three names',
    all("Join-Path $root '%s'" % n in PS1 for n in (
        'alerts.jsonl', 'alerts-sent-bot.txt', 'alerts-sent-webhook.txt')))
yes('W1 the bot and the watchdog agree a message a day old is not posted',
    bot.WATCH_ALERT_MAX_AGE == 24 * 3600 and '$alertMaxAge = 24 * 3600' in PS1)

TMP = tempfile.mkdtemp(prefix='thornswood-watchalerts-bot-')

# ---------------------------------------------- an outbox the watchdog wrote --
emitted = os.path.join(TMP, 'emitted.jsonl')
ps = shutil.which('pwsh')
real = []
if ps:
    r = subprocess.run(
        [ps, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
         os.path.join(HERE, '..', 'tests', 'test-watch-alerts.ps1'),
         '-Emit', emitted], capture_output=True, text=True, timeout=300)
    if r.returncode == 0 and os.path.exists(emitted):
        with open(emitted, 'rb') as f:
            real = f.read().decode('utf-8-sig').splitlines()
    else:
        print(r.stdout + r.stderr)
yes('W2 the real watchdog, driven by test-watch-alerts.ps1, wrote an outbox',
    len(real) == 3)
rows = [json.loads(x) for x in real] if len(real) == 3 else []
# The watchdog's clock in that run is 28 September 2026, so "now" is its own.
now = max([r['at'] for r in rows] or [0])
due = bot.watch_alerts_due(real, set(), now)
yes('W2 the bot reads every message in it, in order',
    [d[0] for d in due] == [r['id'] for r in rows] and len(due) == 3)
yes('W2 and says them in the watchdog\'s words',
    len(due) == 3 and due[0][1].startswith('**The live game server is down.**')
    and due[1][1].startswith('**The live game server is back.**')
    and due[2][1].startswith('**The Discord bot is down.**'))
yes('W2 what either side has said is not said again',
    len(rows) == 3 and [d[0] for d in bot.watch_alerts_due(
        real, {rows[0]['id']}, now)] == [r['id'] for r in rows[1:]])


# --------------------------------------------------- what is due, by hand --
def row(i, at, text='**Thing is down.** It stopped.'):
    return json.dumps({'id': i, 'at': at, 'service': 'thing', 'kind': 'down',
                       'text': text})


T = 1790000000
lines = ['not json', '{"id": "no-text", "at": %d}' % T, row('a', T),
         row('a', T + 1), row('old', T - 24 * 3600 - 1), row('b', T + 2),
         '{"id": "", "at": %d, "text": "x"}' % T]
got = bot.watch_alerts_due(lines, set(), T + 5)
yes('W3 a line that is not a message is skipped, not the end of the rest',
    [g[0] for g in got] == ['a', 'b'])
yes('W3 an id written twice is said once', [g[0] for g in got].count('a') == 1)
yes('W3 a message more than a day old is not said',
    'old' not in [g[0] for g in got])
yes('W3 a message is cut to what Discord takes',
    len(bot.watch_alerts_due([row('long', T, 'x' * 5000)], set(), T)[0][1]) == 1900)


# ---------------------------------------------------- the loop, end to end --
class AsyncioShim(object):
    """Everything asyncio does, except sleeping."""

    def __init__(self, on_sleep):
        self._on_sleep = on_sleep

    def __getattr__(self, name):
        return getattr(asyncio, name)

    async def sleep(self, _seconds):
        return self._on_sleep()


class Stop(BaseException):
    """Ends the loop. BaseException, because the loop catches Exception."""


class Channel(object):
    def __init__(self, cid, name, box, fail=None):
        self.id = cid
        self.name = name
        self._box = box
        self._fail = fail

    async def send(self, text, **kwargs):
        self.last_kwargs = kwargs
        if self._fail and self._fail[0]:
            raise RuntimeError('Discord said no')
        self._box.append((self.id, text))


STAFF_ID = 424242
posted = []
public = []
refuse = [False]


class Guild(object):
    # A public channel with the same name as the staff one, which is what this
    # server actually has. Anything that lands here is the failure.
    text_channels = [Channel(1, 'news', public)]


class FakeClient(object):
    guilds = [Guild()]
    asked = []

    async def wait_until_ready(self):
        return None

    def is_closed(self):
        return False

    def get_channel(self, cid):
        self.asked.append(cid)
        if cid == STAFF_ID:
            return Channel(STAFF_ID, 'news', posted, refuse)
        return None


box = os.path.join(TMP, 'box')
os.makedirs(box)
outbox = os.path.join(box, 'alerts.jsonl')
mine = os.path.join(box, 'alerts-sent-bot.txt')
hook = os.path.join(box, 'alerts-sent-webhook.txt')
NOW = int(time.time())


def add(path, text):
    with open(path, 'ab') as f:
        f.write(text.encode('utf-8'))


def raising(_path):
    raise RuntimeError('the read itself blew up')


real_lines = bot._watch_lines


def step0():
    # Two go down; the webhook already said one of them while the bot was down.
    add(outbox, row('game-down', NOW) + '\r\n' + row('voice-down', NOW) + '\r\n')
    add(hook, 'voice-down\r\n')


def step1():
    # Half a line, the watchdog halfway through writing it.
    add(outbox, row('dev-down', NOW)[:30])


def step2():
    add(outbox, row('dev-down', NOW)[30:] + '\r\n')


def step3():
    refuse[0] = True
    add(outbox, row('game-back', NOW) + '\r\n' + row('dev-back', NOW) + '\r\n')


def step4():
    refuse[0] = False


def step5():
    bot._watch_lines = raising


def step6():
    bot._watch_lines = real_lines


steps = [step0, step1, step2, step3, step4, step5, step6]
after = []


def on_sleep():
    after.append(len(posted))
    i = len(after) - 1
    if i >= len(steps):
        raise Stop()
    steps[i]()


def run():
    try:
        asyncio.run(bot.watch_services())
    except Stop:
        pass


keep = (bot.client, bot.WATCH_ID, bot.WATCH_DIR, bot.WATCH_ALERTS,
        bot.WATCH_SENT_BOT, bot.WATCH_SENT_HOOK, bot.asyncio, bot._watch_lines)
bot.client = FakeClient()
bot.WATCH_ID = STAFF_ID
bot.WATCH_DIR = box
bot.WATCH_ALERTS = outbox
bot.WATCH_SENT_BOT = mine
bot.WATCH_SENT_HOOK = hook
# A message a day old, from before this bot started, is not news.
add(outbox, row('yesterday', NOW - 25 * 3600) + '\r\n')
bot.asyncio = AsyncioShim(on_sleep)
try:
    run()
    yes('W4 a day-old message is not said', after[:1] == [0])
    yes('W4 a new message is said on the next read, and one the webhook '
        'already said is not', after[1:2] == [1])
    yes('W4 half a line says nothing until it is whole', after[2:3] == [1])
    yes('W4 and then it is said once', after[3:4] == [2])
    yes('W4 a message Discord refused is not marked, and the one after it '
        'waits so they stay in order', after[4:5] == [2])
    yes('W4 both are said on the next read', after[5:6] == [4])
    yes('W4 a read that raises says nothing and does not end the loop',
        after[6:7] == [4] and len(after) == 8)
    with open(mine, encoding='ascii') as f:
        marked = [x.strip() for x in f if x.strip()]
    yes('W4 every id the bot said is in alerts-sent-bot.txt, once',
        marked == ['game-down', 'dev-down', 'game-back', 'dev-back'])
    yes('W4 every message went to the staff channel, found by id',
        posted and all(cid == STAFF_ID for cid, _ in posted)
        and set(FakeClient.asked) == set([STAFF_ID]))
    yes('W4 AND NOTHING WENT TO THE PUBLIC CHANNEL WITH THE SAME NAME',
        public == [])

    # A restart of the bot: a fresh loop, nothing new in the outbox.
    before = len(posted)
    after[:] = []
    steps[:] = []
    run()
    yes('W5 a restarted bot says nothing it said before',
        len(posted) == before)
    yes('W5 an outbox that cannot be read is None, not empty',
        bot._watch_lines(box) is None and bot._watch_lines(
            os.path.join(box, 'nothing-here.jsonl')) == [])
finally:
    (bot.client, bot.WATCH_ID, bot.WATCH_DIR, bot.WATCH_ALERTS,
     bot.WATCH_SENT_BOT, bot.WATCH_SENT_HOOK, bot.asyncio,
     bot._watch_lines) = keep

# ------------------------------------------------ nothing but the staff id --
# #staff-updates (Patrick, 11 Oct), from staff-channel.txt, and never the dev
# updates channel in dev-channel.txt, where the watchdog spoke until #2501.
with open(os.path.join(HERE, 'staff-channel.txt')) as f:
    staff_file = int(f.read().strip())
with open(os.path.join(HERE, 'dev-channel.txt')) as f:
    dev_file = int(f.read().strip())
yes('W6 the channel is an id, taken from staff-channel.txt',
    isinstance(bot.WATCH_ID, int) and bot.WATCH_ID > 0
    and bot.WATCH_ID == bot._staff_channel_id() == staff_file)
yes('W6 that id is #staff-updates, 1549254991082946570',
    bot.WATCH_ID == 1549254991082946570)
yes('W6 AND NOT THE DEV UPDATES CHANNEL, where dev releases are announced',
    bot.WATCH_ID != dev_file and not hasattr(bot, '_dev_channel_id'))


class NoChannel(object):
    guilds = []

    def get_channel(self, _id):
        return None


keep_c, keep_id = bot.client, bot.WATCH_ID
bot.client = NoChannel()
try:
    r1 = asyncio.run(bot.watch_say('this must not appear anywhere'))
    bot.WATCH_ID = 0
    r2 = asyncio.run(bot.watch_say('nor this'))
    yes('W6 a channel the bot cannot see, or no id, is silence and says so',
        r1 is False and r2 is False and public == [])
finally:
    bot.client, bot.WATCH_ID = keep_c, keep_id

src = open(os.path.join(HERE, 'bot.py'), encoding='utf-8').read()
guard = src[src.index('    if not _watching:'):src.index("    log('up as")]
yes('W7 on_ready starts it, once, beside the other watchers',
    'asyncio.create_task(watch_services())' in guard)
yes('W7 and there is one watcher of outages, not two: the site watcher that '
    'asked the same address as the watchdog is gone',
    'watch_site' not in src and 'site_answers' not in src)
_start = src.index('async def watch_services():')
body = src[_start:src.index('\ndef ', _start)]
yes('W7 it speaks only through watch_send, which has no public fallback',
    'watch_send(' in body and '.send(' not in body and 'by_name' not in body)

# ------------------------------------------------ mentions stay off ---------
# Issue #1353. The watchdog's sentence can carry a name or a line from
# somewhere else. watch_say must hand Discord allowed_mentions with every
# kind switched off, which Discord honors even when the text still says
# @everyone. This inspects the call. It does not post.

class RecordingChannel(object):
    def __init__(self):
        self.sent = []

    async def send(self, text, **kwargs):
        self.sent.append((text, kwargs))


class RecordingClient(object):
    def __init__(self, ch):
        self._ch = ch

    def get_channel(self, _id):
        return self._ch


rec = RecordingChannel()
keep_c, keep_id = bot.client, bot.WATCH_ID
bot.client = RecordingClient(rec)
bot.WATCH_ID = STAFF_ID
try:
    planted = 'caddy DOWN @everyone @here <@&123>'
    ok = asyncio.run(bot.watch_say(planted))
    mentions = rec.sent[0][1].get('allowed_mentions') if rec.sent else None
    yes('W8 an alert that says @everyone is sent with every mention switched off',
        ok is True and len(rec.sent) == 1 and rec.sent[0][0] == planted
        and mentions is not None
        and mentions.everyone is False and mentions.users is False
        and mentions.roles is False and mentions.replied_user is False)
finally:
    bot.client, bot.WATCH_ID = keep_c, keep_id

# ------------------------------------------------ taking a notice back -----
# Issue #3328. A notice that should not have gone out comes down again: the
# bot keeps the message each notice became, and takes back what
# alerts-unsay.txt names, once each.
plan = bot.unsay_plan(
    ['kept', 'old', 'hooked', 'queued', 'nobody', 'kept', 'done-before', ''],
    {'done-before': ['deleted']}, {'kept': ['424242', '9001']},
    {'kept', 'old'}, {'hooked'}, {'queued': 'x', 'old': 'y'})
yes('W9 each ask is planned once, by what is known of it',
    plan == [('kept', 'message'), ('old', 'look'), ('hooked', 'webhook'),
             ('queued', 'withhold'), ('nobody', 'unknown')])


class Msg(object):
    def __init__(self, mid, content, author, box):
        self.id = mid
        self.content = content
        self.author = author
        self._box = box

    async def delete(self):
        if self.id in self._box['gone']:
            raise bot.discord.NotFound(type('R', (), {'status': 404, 'reason': 'gone'})(), 'gone')
        self._box['deleted'].append(self.id)


class Me(object):
    id = 77


class Someone(object):
    id = 88


class UnsayChannel(object):
    id = STAFF_ID
    name = 'staff-updates'

    def __init__(self, box):
        self.box = box
        self.sent = []

    async def send(self, text, **kwargs):
        m = Msg(5000 + len(self.sent), text, Me(), self.box)
        self.sent.append(m)
        return m

    def get_partial_message(self, mid):
        return Msg(mid, None, Me(), self.box)

    async def _history(self, limit):
        for m in self.box['history'][:limit]:
            yield m

    def history(self, limit=100):
        return self._history(limit)


class UnsayClient(object):
    user = Me()

    def __init__(self, ch):
        self._ch = ch

    async def wait_until_ready(self):
        return None

    def is_closed(self):
        return False

    def get_channel(self, cid):
        return self._ch if cid == STAFF_ID else None


ubox = os.path.join(TMP, 'unsay')
udata = os.path.join(TMP, 'unsay-data')
os.makedirs(ubox)
os.makedirs(udata)
names = ('client', 'WATCH_ID', 'WATCH_ALERTS', 'WATCH_SENT_BOT', 'WATCH_SENT_HOOK',
         'WATCH_UNSAY', 'STAFF_MESSAGES', 'STAFF_UNSAID', 'asyncio')
keep = tuple(getattr(bot, n) for n in names)
store = {'deleted': [], 'gone': [9002], 'history': []}
uch = UnsayChannel(store)
bot.client = UnsayClient(uch)
bot.WATCH_ID = STAFF_ID
bot.WATCH_ALERTS = os.path.join(ubox, 'alerts.jsonl')
bot.WATCH_SENT_BOT = os.path.join(ubox, 'alerts-sent-bot.txt')
bot.WATCH_SENT_HOOK = os.path.join(ubox, 'alerts-sent-webhook.txt')
bot.WATCH_UNSAY = os.path.join(ubox, 'alerts-unsay.txt')
bot.STAFF_MESSAGES = os.path.join(udata, 'staff-messages.txt')
bot.STAFF_UNSAID = os.path.join(udata, 'staff-unsaid.txt')


def notice(i, text):
    return json.dumps({'id': i, 'at': NOW, 'service': 'agent claude',
                       'kind': 'notice', 'text': text})


# Said before message ids were kept: one of the bot's own posts with its
# words, and somebody else's post with the same words, which stays.
add(bot.WATCH_ALERTS, notice('agent-claude-old', '[claude] Old words.') + '\r\n')
add(bot.WATCH_SENT_BOT, 'agent-claude-old\r\n')
add(bot.WATCH_SENT_HOOK, '')
store['history'] = [Msg(7001, '[claude] Old words.', Someone(), store),
                    Msg(7002, '[claude] Old words.', Me(), store)]
ustep = [0]


def unsay_steps():
    ustep[0] += 1
    if ustep[0] == 1:
        # Said this run, its message kept; then three asks and one not yet said.
        add(bot.WATCH_UNSAY, 'agent-claude-new\r\nagent-claude-old\r\nagent-claude-later\r\n')
        add(bot.WATCH_ALERTS, notice('agent-claude-later', '[claude] Never said.') + '\r\n')
    elif ustep[0] == 2:
        add(bot.WATCH_UNSAY, 'agent-claude-new\r\n')
    else:
        raise Stop()


add(bot.WATCH_ALERTS, notice('agent-claude-new', '[claude] New words.') + '\r\n')
bot.asyncio = AsyncioShim(unsay_steps)
try:
    try:
        asyncio.run(bot.watch_services())
    except Stop:
        pass
    kept = bot._watch_table(bot.STAFF_MESSAGES)
    yes('W9 the bot keeps the message each notice became',
        kept.get('agent-claude-new') == [str(STAFF_ID), '5000'])
    unsaid = bot._watch_table(bot.STAFF_UNSAID)
    yes('W9 a kept message is deleted by its id', unsaid.get('agent-claude-new') == ['deleted']
        and 5000 in store['deleted'])
    yes('W9 one said before ids were kept is found by its words, and only the bot\'s own',
        unsaid.get('agent-claude-old') == ['deleted'] and 7002 in store['deleted']
        and 7001 not in store['deleted'])
    yes('W9 one not said yet is withheld: never said, and marked so the webhook does not say it',
        unsaid.get('agent-claude-later') == ['withheld']
        and [m.content for m in uch.sent] == ['[claude] New words.']
        and 'agent-claude-later' in bot._watch_lines(bot.WATCH_SENT_BOT))
    with open(bot.STAFF_UNSAID, encoding='utf-8') as f:
        lines_unsaid = [x for x in f if x.strip()]
    yes('W9 an ask made twice is done once', len(lines_unsaid) == 3
        and store['deleted'].count(5000) == 1)
finally:
    for n, v in zip(names, keep):
        setattr(bot, n, v)

shutil.rmtree(TMP, ignore_errors=True)
done()
