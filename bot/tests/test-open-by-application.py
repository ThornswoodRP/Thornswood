"""
test-open-by-application.py

The Discord side of #428: "There is no public mode: the panel, the read-only
posts, the access list and the age question all describe the closed
playtest, and nobody ever accepts the rules."

Patrick, 28 Sep: "we are in alpha so the world is open by application".
Anyone can download it, getting in is an application in the Discord, the
Playtester role that comes with being accepted unlocks Play, and it is an
alpha. So this checks:

  1. The panel and its first kind say that, and nothing says closed playtest.
  2. The application asks the age question (18 and over stays) and a rules
     question, inside Discord's five question limit and its label lengths.
  3. A yes to the rules goes to the site with the ticket, where it is kept
     against the Discord id; anything else is flagged at the top of the
     thread for staff, and never stops the application.
  4. The read only posts (#welcome, #rules, #faq, #start-here) say the same,
     read from the real content.py.
  5. The one switch the issue asked for, the site's "open", built and left
     off: the bot reads it off /api/public (THORNSWOOD_OPEN overrides), and
     on, the application and its two questions leave the panel and the posts
     say anyone in the Discord can play. Off puts it all back.

The real bot module is imported and the real TicketModal.on_submit is run.
Only what touches the world is replaced: the guild, the thread, the
interaction, the push to the site and the file of open tickets, which goes in
a temporary folder. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import re
import shutil
import tempfile

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
import content  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def closed(text):
    return re.search(r'closed[\s-]+playtest', text or '', re.I) is not None


# ------------------------------------------------------------ 1. the panel --
first = bot.KINDS[0]
yes('the first kind on the panel is still the way in, filed as playtest',
    first[0] == 'playtest')
yes('and it is called Apply to be an alpha playtester, as the site says',
    first[1] == 'Apply to be an alpha playtester')
yes('its label fits a Discord modal title (45)', len(first[1]) <= 45)
yes('its description fits a dropdown option (100)', len(first[2]) <= 100)
yes('its description says anyone can apply', 'Anyone can apply' in first[2])
yes('and the role it asks for is Playtester', bot.ROLE_FOR['playtest'] == 'Playtester')

for w in ('open by application', 'Anyone', 'download', 'Apply to be an alpha playtester',
          'Playtester', 'Play', '18', 'rules'):
    yes('the panel says ' + w, w in bot.PANEL)
yes('the panel no longer says Apply to playtest', 'Apply to playtest' not in bot.PANEL)
yes('no kind or panel text says closed playtest',
    not closed(bot.PANEL) and not any(closed(l + ' ' + d) for _, l, d in bot.KINDS))
yes('the panel fits one Discord message', len(bot.PANEL) < 2000)
yes('the panel has no em dash', chr(0x2014) not in bot.PANEL)
yes('the panel does not use the word the house rules keep out',
    not re.search(r'\bplayers?\b', bot.PANEL, re.I))

# --------------------------------------------------- 2. the two questions --
qs = bot.QUESTIONS['playtest']
yes('the application asks at most five questions, which is all Discord takes',
    len(qs) <= 5)
yes('the age question is still first, 18 and over stays', qs[0] == bot.AGE_Q)
yes('the rules question is asked', bot.RULES_Q in qs)
yes('every label fits Discord (45) and every hint (100)',
    all(len(q) <= 45 and len(h) <= 100 for q, h, _ in qs))
yes('the rules question is asked on the same tickets as the age question',
    tuple(bot.RULES_KINDS) == tuple(bot.AGE_KINDS) and 'playtest' in bot.RULES_KINDS)
yes('it is a short answer, like the age one', bot.RULES_Q[2] is False)
yes('and nothing else on the panel asks it',
    all(bot.RULES_Q not in bot.QUESTIONS[k] for k, _, _ in bot.KINDS if k not in bot.RULES_KINDS))

for said in ('yes', 'Yes', 'y', 'yep I have read them', 'I accept', 'i agree',
             'Accepted', 'of course', 'ok', 'I do', "I've read and accept them"):
    yes('"%s" reads as accepting the rules' % said, bot.accepted_rules(said))
for said in ('', '   ', 'no', 'No.', 'n', 'nope', 'not yet', "I don't", 'i do not',
             "haven't read them", 'dont care', 'maybe later', 'what rules'):
    yes('"%s" does not' % said, not bot.accepted_rules(said))


# ---------------------------------------------------- 3. the record, run --
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


class Perms(object):
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
        self.sent = []

    async def add_user(self, m):
        pass

    async def send(self, text=None, **k):
        self.sent.append(text or '')


class Channel(object):
    def __init__(self, name, guild):
        self.name = name
        self.guild = guild
        self.made = []

    def permissions_for(self, who):
        return Perms(who is self.guild.me)

    async def create_thread(self, name=None, **k):
        t = Thread(9000 + len(self.made), name)
        self.made.append(t)
        self.guild.threads[t.id] = t
        return t

    async def send(self, *a, **k):
        pass


class Guild(object):
    def __init__(self, staff):
        self.id = 1
        self.name = 'Thornswood'
        self.me = Person(1, 'Thornswood')
        self.me.bot = True
        self.threads = {}
        self.roles = [Role('Moderator', [staff])]
        self.text_channels = [Channel(bot.TICKETS[0], self)]

    def get_thread(self, tid):
        return self.threads.get(tid)


class Response(object):
    def __init__(self):
        self.said = []

    async def send_modal(self, modal):
        pass

    async def send_message(self, text, ephemeral=False, **k):
        self.said.append(text)

    async def defer(self, **k):
        pass


class Followup(object):
    def __init__(self):
        self.said = []

    async def send(self, text, ephemeral=False, **k):
        self.said.append(text)


class Interaction(object):
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        self.channel = guild.text_channels[0]
        self.response = Response()
        self.followup = Followup()


PUSHED = []


async def _push(*a):
    PUSHED.append(a)

bot.push_async = _push
bot.log = lambda *a: None
TMP = tempfile.mkdtemp(prefix='thornswood-open-')
bot.OPEN_TICKETS = os.path.join(TMP, 'open-tickets.json')


def apply(uid, name, answers, kind='playtest'):
    """One application, answered in order, run through the real on_submit."""
    bot._last_ticket.clear()
    if os.path.exists(bot.OPEN_TICKETS):
        os.remove(bot.OPEN_TICKETS)
    staff = Person(3, 'Mo', [Role('Moderator')])
    g = Guild(staff)
    who = Person(uid, name)
    lab = dict((a, b) for a, b, _ in bot.KINDS)[kind]
    m = bot.TicketModal(kind, lab)
    for f, v in zip(m.fields, answers):
        f._value = v
    before = len(PUSHED)
    asyncio.run(m.on_submit(Interaction(g, who)))
    thread = g.text_channels[0].made[0] if g.text_channels[0].made else None
    text = '\n'.join(thread.sent) if thread else ''
    pushed = PUSHED[before] if len(PUSHED) > before else None
    return text, pushed


try:
    rest = ['A hunter out of Falkreath. Some on another server.', 'Evenings.', 'None yet.']

    text, pushed = apply(501, 'Ann', ['yes, 27', 'Yes, I accept them'] + rest)
    yes('an application that accepts the rules opens its thread', bool(text))
    yes('and the thread carries the rules question and the answer',
        bot.RULES_Q[0] in text and 'Yes, I accept them' in text)
    yes('and is not flagged about the rules', 'accept the rules they said' not in text)
    yes('and is not flagged at all', 'CHECK THIS ONE' not in text)
    yes('the site gets the answer with the ticket, against the Discord id',
        pushed is not None and len(pushed) == 6 and pushed[4] == 501
        and pushed[5] == {'said': 'Yes, I accept them', 'yes': True})

    text, pushed = apply(502, 'Bea', ['yes', 'no'] + rest)
    yes('a no to the rules is flagged at the top for staff',
        text.find('**CHECK THIS ONE.** Asked if they accept the rules they said "no"') != -1
        and text.find('CHECK THIS ONE') < text.find('**Asking for:**'))
    yes('and it still opens, a person decides', bool(text))
    yes('and the site gets the no as a no', pushed is not None and pushed[5] == {'said': 'no', 'yes': False})

    text, pushed = apply(503, 'Cy', ['16', 'yes'] + rest)
    yes('the age flag still fires on its own', 'Asked if they are 18 or over they said "16"' in text)
    yes('beside a rules yes that is not flagged', 'accept the rules they said' not in text)

    text, pushed = apply(504, 'Di', ['yes', ''] + rest)
    yes('an empty rules answer is flagged as nothing',
        'Asked if they accept the rules they said "nothing"' in text)

    text, pushed = apply(505, 'Ed', ['It will not start', 'Launching', 'An error'], kind='help')
    yes('a help ticket does not ask the rules, and sends no rules answer',
        pushed is not None and pushed[5] is None and bot.RULES_Q[0] not in text)

    # What push actually sends. Only the network is replaced.
    import json
    import urllib.request
    sent = []

    class _R(object):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{}'

    keep = (urllib.request.urlopen, bot.KEY)
    urllib.request.urlopen = lambda req, timeout=None: (sent.append(json.loads(req.data)), _R())[1]
    bot.KEY = 'not-a-real-key'
    try:
        bot.push('playtest', 't', 'd', 'ann', 501, {'said': 'yes', 'yes': True})
        bot.push('help', 't', 'd', 'ann', 501)
    finally:
        urllib.request.urlopen, bot.KEY = keep
    yes('push sends the rules answer to /api/ticket when there is one',
        len(sent) == 2 and sent[0].get('rules') == {'said': 'yes', 'yes': True}
        and sent[0].get('discordId') == '501')
    yes('and leaves it out when there is none', len(sent) == 2 and 'rules' not in sent[1])
finally:
    shutil.rmtree(TMP, ignore_errors=True)

# ----------------------------------------------------- 4. the read only posts --
for name in ('WELCOME', 'RULES', 'START', 'FAQ', 'GAME_RULES', 'LINKS'):
    yes('#%s does not say closed playtest' % name.lower(), not closed(getattr(content, name)))
yes('#welcome says the world is open by application',
    'open by application' in content.WELCOME and 'Anyone can download' in content.WELCOME)
yes('#welcome names the application and the role that unlocks Play',
    'Apply to be an alpha playtester' in content.WELCOME and 'Playtester role' in content.WELCOME)
yes('#welcome says to read the rules before applying in #apply-to-playtest',
    content.WELCOME.find('<#RULES>') < content.WELCOME.find('<#PLAYTEST>'))
yes('#welcome no longer says people are let in slowly',
    'letting people in slowly' not in content.WELCOME and 'Not open to everyone' not in content.WELCOME)
yes('#rules says applying is accepting them, and that the answer is kept',
    'Applying means accepting them' in content.RULES and 'kept against your Discord account' in content.RULES)
yes('#faq answers why you cannot get in with the application, not a closed playtest',
    'open by application' in content.FAQ and 'Apply to be an alpha playtester' in content.FAQ)
yes('#faq no longer says letting people in slowly', 'slowly' not in content.FAQ)
yes('#start-here carries the join page, which says open by application',
    'open by application' in content.START and 'Apply to be an alpha playtester' in content.START)
for name in ('WELCOME', 'RULES', 'FAQ'):
    text = getattr(content, name)
    yes('#%s has no em dash and no word the house rules keep out' % name.lower(),
        chr(0x2014) not in text and not re.search(r'\bplayers?\b', text, re.I))

# ------------------------------------------------ 5. the one switch, off --
#
# The site's config.json "open", read off /api/public. Built, and left off:
# Patrick decides whether and when to flip it.
yes('the bot starts in the alpha: switch off', bot.OPEN is False and bot.PANEL == bot.PANEL_ALPHA)

keep_env = os.environ.pop('THORNSWOOD_OPEN', None)
keep_open = urllib.request.urlopen


class _Pub(object):
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.body


asked = []


def _site(body):
    def fake(url, timeout=None):
        asked.append(url)
        if body is None:
            raise OSError('site down')
        return _Pub(body)
    return fake


try:
    urllib.request.urlopen = _site(b'{"open": false, "invite": "x"}')
    yes('the site saying open false is the alpha', bot.site_open() is False)
    yes('and it asked the site\'s public page', asked and asked[-1] == bot.SITE + '/api/public')
    urllib.request.urlopen = _site(b'{"open": true}')
    yes('the site saying open true is open', bot.site_open() is True)
    urllib.request.urlopen = _site(b'{"open": "true"}')
    yes('only a real true opens it, not the word', bot.site_open() is False)
    urllib.request.urlopen = _site(b'{}')
    yes('a site that does not say is the alpha', bot.site_open() is False)
    urllib.request.urlopen = _site(None)
    yes('a site that cannot be reached is the alpha', bot.site_open() is False)
    os.environ['THORNSWOOD_OPEN'] = '1'
    urllib.request.urlopen = _site(b'{"open": false}')
    yes('THORNSWOOD_OPEN=1 in bot.env.json overrides the site', bot.site_open() is True)
    os.environ['THORNSWOOD_OPEN'] = '0'
    urllib.request.urlopen = _site(b'{"open": true}')
    yes('THORNSWOOD_OPEN=0 overrides it the other way', bot.site_open() is False)
finally:
    urllib.request.urlopen = keep_open
    os.environ.pop('THORNSWOOD_OPEN', None)
    if keep_env is not None:
        os.environ['THORNSWOOD_OPEN'] = keep_env

# ------------------------------------------------- 6. the one switch, on --
bot.set_open(True)
try:
    yes('open: the application is gone from the panel',
        'playtest' not in [k for k, _, _ in bot.KINDS])
    yes('open: everything else on the panel stays, in order',
        [k for k, _, _ in bot.KINDS] == [k for k, _, _ in bot.KINDS_ALPHA if k != 'playtest'])
    yes('open: the age and rules questions are no longer asked on any ticket',
        tuple(bot.AGE_KINDS) == () and tuple(bot.RULES_KINDS) == ())
    yes('open: the panel is the open one', bot.PANEL == bot.PANEL_OPEN and bot.OPEN is True)
    yes('open: the panel says anyone in the Discord can play and there is nothing to apply for',
        'anyone in the Discord can play' in bot.PANEL and 'nothing to apply for' in bot.PANEL)
    yes('open: the panel does not mention the application',
        'alpha playtester' not in bot.PANEL and 'Playtester role' not in bot.PANEL)
    yes('open: a posted alpha panel is out of date, so it is edited',
        not bot.panel_is_current(type('M', (), {'content': bot.PANEL_ALPHA, 'components': []})()))
finally:
    bot.set_open(False)
yes('and off again puts the application back first, with both questions',
    bot.KINDS[0][0] == 'playtest' and bot.KINDS == bot.KINDS_ALPHA
    and 'playtest' in bot.AGE_KINDS and 'playtest' in bot.RULES_KINDS
    and bot.PANEL == bot.PANEL_ALPHA)

# The read only posts, the same switch, handed in by Setup-Discord.ps1.
import importlib  # noqa: E402
os.environ['THORNSWOOD_OPEN'] = '1'
try:
    opened = importlib.reload(content)
    yes('open posts: content.py sees the switch', opened.OPEN is True)
    yes('open posts: #welcome says anyone here can play, with no application',
        'anyone here can play' in opened.WELCOME and 'Apply to be an alpha playtester' not in opened.WELCOME)
    yes('open posts: #rules says being here is accepting them',
        'Being here and in the world means accepting these rules' in opened.RULES
        and 'application' not in opened.RULES)
    yes('open posts: #faq has no application in it', 'Apply to be an alpha playtester' not in opened.FAQ)
    yes('open posts: #start-here is the open join page, with no alpha step',
        '## 1. Come into the Discord' in opened.START and '## 1. Apply' not in opened.START
        and 'Step 1 happens in' not in opened.START)
    yes('open posts: no marker is left in any post',
        not any('<!--' in getattr(opened, n) for n in ('WELCOME', 'START', 'FAQ', 'RULES')))
finally:
    os.environ.pop('THORNSWOOD_OPEN', None)
    if keep_env is not None:
        os.environ['THORNSWOOD_OPEN'] = keep_env
    closed_again = importlib.reload(content)
yes('alpha posts again once the switch is off: #start-here has step 1 Apply',
    closed_again.OPEN is False and '## 1. Apply' in closed_again.START
    and '## 1. Come into the Discord' not in closed_again.START)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
