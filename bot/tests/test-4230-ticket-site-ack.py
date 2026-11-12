"""
test-4230-ticket-site-ack.py

Issue #4230. When the bot can neither open a ticket's thread nor post it in
the staff only log channel, the site's inbox is the only copy of it. The bot
still told the person, by message and in its reply, that nothing was lost and
it was in the staff inbox, before the site copy was even sent: push was
started as a task nobody waited on, returned nothing, and a send that failed,
or a bot with no site key, was a line in the bot's log and nothing else.

The site's POST /api/ticket answers 200 {"ok": true} only once the inbox
file is written (site/lib/serve.js), so that answer is what "it is in the
staff inbox" has to follow.

The real TicketModal.on_submit runs on a server with no tickets channel and
no staff channel, so Discord holds no copy:

  S1 the site takes its time and then takes it: nobody is told anything
     until it has answered, and then the message and the reply say it is in
     the staff inbox.
  S2 the site refuses it (500, could not save): neither the message nor the
     reply says it is safe or in the inbox; the reply asks them to try again
     or message staff, and they may send it again at once.
  S3 the site answers 200 without ok: the same as a refusal.
  S4 no site key: the same, and the log still says the key is missing.
  P  push itself says whether the site took it: True on 200 {"ok": true},
     False on anything else.

Never connects to anything.
"""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import io
import shutil
import tempfile
import threading
import urllib.error
import urllib.request

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


HOLD = 2.0
ANSWERS = ['It will not connect', 'Launching it from the desktop', 'Connection refused']
SAFE_WORDS = ('Nothing is lost', 'staff inbox', 'Sent to staff', 'reached staff')


class Answer(object):
    def __init__(self, value):
        self.value = value


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


class NoManage(object):
    manage_channels = False


class Guild(object):
    """No tickets channel and no staff channel: Discord can hold no copy."""
    def __init__(self):
        self.id = 7
        self.text_channels = []
        self.voice_channels = []
        self.default_role = Role('@everyone', [])
        self.roles = [self.default_role, Role('Moderator', [Member(3, 'moderator')])]
        self.me = Member(1, 'thornswood', is_bot=True)
        self.me.guild_permissions = NoManage()

    def get_thread(self, tid):
        return None


class Response(object):
    def __init__(self, events):
        self.events = events

    async def defer(self, ephemeral=False, thinking=False):
        self.events.append('deferred')


class Followup(object):
    def __init__(self, events):
        self.events = events
        self.said = []

    async def send(self, text, ephemeral=False):
        await asyncio.sleep(0)
        self.said.append(text)
        self.events.append('acknowledged')


class Interaction(object):
    def __init__(self, guild, user, events):
        self.guild = guild
        self.user = user
        self.channel = None
        self.response = Response(events)
        self.followup = Followup(events)


class Answered(object):
    """What urlopen hands back: a status and a body."""
    def __init__(self, status, body):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def site(events, gate, status=200, body=b'{"ok": true}', seen=None):
    """urlopen standing in for the site's POST /api/ticket, held until the
       test lets it go (or HOLD passes), then answering as given."""
    def fake(req, timeout=None):
        if seen is not None:
            seen.append(req.full_url)
        events.append('site push starts')
        gate.wait(HOLD)
        events.append('site push finished')
        if status >= 400:
            raise urllib.error.HTTPError(req.full_url, status, 'could not save', {},
                                         io.BytesIO(b'{"error": "could not save"}'))
        return Answered(status, body)
    return fake


TMP = tempfile.mkdtemp(prefix='thornswood-4230-')
bot.OPEN_TICKETS = os.path.join(TMP, 'open-tickets.json')


def submit(status=200, body=b'{"ok": true}', key='not-a-real-key'):
    out = {'events': [], 'lines': [], 'raised': None, 'seen': []}
    events = out['events']
    gate = threading.Event()
    bot._last_ticket.clear()
    if os.path.exists(bot.OPEN_TICKETS):
        os.remove(bot.OPEN_TICKETS)

    async def go():
        who = Member(42, 'ada', events)
        guild = Guild()
        inter = Interaction(guild, who, events)
        out['who'] = who
        out['followup'] = inter.followup
        out['guild'] = guild
        keep = (bot.log, bot.KEY, urllib.request.urlopen)
        bot.log = lambda *a: out['lines'].append(' '.join(str(x) for x in a))
        bot.KEY = key
        urllib.request.urlopen = site(events, gate, status, body, out['seen'])
        try:
            modal = bot.TicketModal('help', 'I need help')
            modal.fields = [Answer(v) for v in ANSWERS]
            try:
                await modal.on_submit(inter)
            except Exception as e:
                out['raised'] = e
            events.append('on_submit returned')
            gate.set()
            pending = list(getattr(bot, '_pushes', ()))
            if pending:
                await asyncio.gather(*pending)
            out['cooled'] = bot._ticket_key(guild, who) in bot._last_ticket
        finally:
            gate.set()
            (bot.log, bot.KEY, urllib.request.urlopen) = keep

    asyncio.run(go())
    return out


def before(events, a, b):
    return a in events and b in events and events.index(a) < events.index(b)


def told(r):
    return ' | '.join(list(r['who'].dms) + list(r['followup'].said))


try:
    # ---------------------------------------------------------------- S1 --
    r = submit()
    ev = r['events']
    yes('S1 with no Discord copy, nobody is told anything until the site has '
        'answered (%r)' % (ev,),
        before(ev, 'site push finished', 'acknowledged')
        and ('direct message' not in ev or before(ev, 'site push finished', 'direct message')))
    yes('S1 and once it has taken it, the reply says it is in the staff inbox (%s)' % told(r),
        any('staff inbox' in s for s in r['followup'].said))
    yes('S1 nothing raised', r['raised'] is None)

    # ---------------------------------------------------------------- S2 --
    r = submit(status=500)
    said = told(r)
    yes('S2 the site refused it: nothing tells them it is safe or in the inbox (%s)' % said,
        not any(w in said for w in SAFE_WORDS))
    yes('S2 and the reply asks them to try again or message staff (%s)' % r['followup'].said,
        any('try again' in s.lower() and 'staff' in s.lower() for s in r['followup'].said))
    yes('S2 and they may send it again now: no five minute wait for a ticket nothing kept',
        r['cooled'] is False)
    yes('S2 and the log says the site did not take it',
        any('site push failed' in l or 'did not take' in l for l in r['lines']))
    yes('S2 nothing raised', r['raised'] is None)

    # ---------------------------------------------------------------- S3 --
    r = submit(status=200, body=b'{"error": "odd"}')
    said = told(r)
    yes('S3 a 200 without ok is not a yes (%s)' % said,
        not any(w in said for w in SAFE_WORDS)
        and any('try again' in s.lower() for s in r['followup'].said))

    # ---------------------------------------------------------------- S4 --
    r = submit(key='')
    said = told(r)
    yes('S4 no site key: nothing tells them it is safe (%s)' % said,
        not any(w in said for w in SAFE_WORDS)
        and any('try again' in s.lower() for s in r['followup'].said))
    yes('S4 and the log still says the key is not set',
        any('THORNSWOOD_KEY is not set' in l for l in r['lines']))
    yes('S4 and nothing was sent to the site', r['seen'] == [])

    # ----------------------------------------------------------------- P --
    def push_with(status, body, key='not-a-real-key'):
        gate = threading.Event()
        gate.set()
        keep = (bot.log, bot.KEY, urllib.request.urlopen)
        bot.log = lambda *a: None
        bot.KEY = key
        urllib.request.urlopen = site([], gate, status, body)
        try:
            return bot.push('help', 't', 'd', 'ada', 42)
        finally:
            (bot.log, bot.KEY, urllib.request.urlopen) = keep
    yes('P1 push says True when the site answers 200 {"ok": true}',
        push_with(200, b'{"ok": true}') is True)
    yes('P2 and False on a refusal, a 200 without ok, or no key',
        push_with(500, b'') is False and push_with(200, b'{"error": 1}') is False
        and push_with(200, b'not json') is False and push_with(200, b'', key='') is False)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
