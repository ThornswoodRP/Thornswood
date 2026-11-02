"""
test-onboarding.py

Issue #427. Build-Onboarding.py sets Discord's onboarding from the rows it was
written out in, mapping every channel and role by name to the ids on the
server when it runs. This runs it against a fake server and proves:

  - every answer gives the role it was written to give, by the real id
    (Member plus its own Citizen role, Not decided yet Member only)
  - nothing it hands out opens the game or carries any power
  - the rules and age questions are off unless asked for
  - --check sends nothing, and a plan Discord would refuse sends nothing
  - the server as gated today (Build-Discord.py THE GATE) is refused, with
    the reason in words, and a server with the nine channels open passes
  - questions already there keep their ids
  - the token is never printed, and no line says player or has an em dash

Never connects to anything. Needs no discord.py.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import importlib.util
import json


PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


spec = importlib.util.spec_from_file_location(
    'build_onboarding', os.path.join(HERE, 'Build-Onboarding.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

VIEW = 1 << 10
SEND = 1 << 11
GID = '900'
TOKEN = 'fake-token-that-must-never-print'

HOLDS = ['Whiterun', 'Solitude', 'Windhelm', 'Riften', 'Markarth',
         'Dawnstar', 'Morthal', 'Falkreath', 'Winterhold']


def roles(extra=None, member_perms=VIEW | SEND, drop=()):
    out = [dict(id=GID, name='@everyone', permissions=str(VIEW | SEND))]
    n = 100
    names = ['Owner', 'Dev', 'Moderator', 'Playtester', 'Member'] + \
            ['Citizen of ' + h for h in HOLDS] + ['Banned', 'Thornswood Bot']
    for name in names:
        if name in drop:
            continue
        n += 1
        perms = VIEW | SEND
        if name in ('Owner', 'Dev', 'Thornswood Bot'):
            perms = 1 << 3
        if name == 'Member':
            perms = member_perms
        out.append(dict(id=str(n), name=name, permissions=str(perms), managed=False))
    return out + (extra or [])


def ch(cid, name, mode, ctype=0):
    """A channel with @everyone's overwrite as Build-Discord.py's modes set it."""
    ow = []
    if mode == 'read':
        ow = [dict(id=GID, type=0, allow='0', deny=str(SEND))]
    elif mode in ('open', 'membersread', 'hold', 'staff', 'pathfind'):
        ow = [dict(id=GID, type=0, allow='0', deny=str(VIEW))]
    return dict(id=str(cid), name=name, type=ctype, permission_overwrites=ow)


def gated():
    """The server as Build-Discord.py's PLAN and the hand set gate describe it."""
    c = [ch(1, 'welcome', 'read'), ch(2, 'rules', 'read'), ch(3, 'start-here', 'read'),
         ch(4, 'say-hello', 'public'), ch(5, 'apply-to-playtest', 'read'),
         ch(6, 'news', 'membersread', 5), ch(7, 'general', 'open'),
         ch(8, 'media', 'open'), ch(9, 'character-introductions', 'open'),
         ch(10, 'tales', 'open', 15), ch(11, 'rp-appreciation', 'open'),
         ch(12, 'test-these', 'pathfind'), ch(13, 'choose-your-hold', 'membersread')]
    for i, h in enumerate(HOLDS):
        c.append(ch(20 + i, h.lower(), 'hold'))
    return dict(id=GID, name='Thornswood', roles=roles(), channels=c)


def opened():
    """The same server with the nine r25n channels open to everybody: four
       read only, five everybody can post in."""
    g = gated()
    mode = {'news': 'read', 'general': 'public', 'media': 'public',
            'character-introductions': 'public', 'tales': 'public',
            'rp-appreciation': 'public'}
    g['channels'] = [ch(c['id'], c['name'], mode[c['name']], c['type'])
                     if c['name'] in mode else c for c in g['channels']]
    return g


class FakeApi(object):
    def __init__(self, guild, onboarding=None, bot_role='Thornswood Bot', refuse_put=None):
        self.guild = guild
        self.onboarding = onboarding or dict(guild_id=GID, prompts=[],
                                             default_channel_ids=[], enabled=False, mode=0)
        self.bot_role = bot_role
        self.refuse_put = refuse_put
        self.calls = []

    def call(self, method, path, body=None, reason=None):
        self.calls.append((method, path, body))
        if method == 'GET' and path == '/users/@me/guilds':
            return [dict(id=GID, name='Thornswood')]
        if method == 'GET' and path == '/guilds/' + GID:
            return dict((k, v) for k, v in self.guild.items() if k != 'channels')
        if method == 'GET' and path == '/guilds/%s/channels' % GID:
            return self.guild['channels']
        if method == 'GET' and path == '/guilds/%s/onboarding' % GID:
            return self.onboarding
        if method == 'GET' and path == '/users/@me':
            return dict(id='555')
        if method == 'GET' and path == '/guilds/%s/members/555' % GID:
            ids = [r['id'] for r in self.guild['roles'] if r['name'] == self.bot_role]
            return dict(roles=ids)
        if method == 'PUT' and path == '/guilds/%s/onboarding' % GID:
            if self.refuse_put:
                raise B.Refused(400, self.refuse_put)
            return dict(body)
        raise AssertionError('unexpected call %s %s' % (method, path))

    def puts(self):
        return [c for c in self.calls if c[0] == 'PUT']


def run(argv, api):
    lines = []
    code = B.main(argv, api=api, out=lines.append)
    return code, '\n'.join(lines)


def rid(g, name):
    return [r['id'] for r in g['roles'] if r['name'] == name][0]


def cid(g, name):
    return [c['id'] for c in g['channels'] if c['name'] == name][0]


everything = []

# 1. The server as it is gated today: refused, in words, nothing sent.
api = FakeApi(gated())
code, text = run(['--check'], api)
everything.append(text)
yes('gated server: --check exits 1', code == 1)
yes('gated server: sends nothing', not api.puts())
yes('gated server: names #general as hidden from people who have just joined',
    '#general (a default channel) is hidden' in text)
yes('gated server: says only 0 default channels let everybody post',
    'Only 0 of the default channels let everybody post' in text)
yes('gated server: says Nothing was changed', 'Nothing was changed.' in text)

api = FakeApi(gated())
code, text = run([], api)
everything.append(text)
yes('gated server without --check: still sends nothing', code == 1 and not api.puts())

# 2. The nine channels open: the default plan passes, and --check sends nothing.
g = opened()
api = FakeApi(g)
code, text = run(['--check'], api)
everything.append(text)
yes('open server: --check exits 0', code == 0)
yes('open server: --check sends nothing', not api.puts())
yes('open server: reports 9 channels, 5 everybody can post in',
    '9 channels, 5 that everybody can post in' in text)

api = FakeApi(g)
code, text = run([], api)
everything.append(text)
put = api.puts()
yes('open server: a real run sends exactly one PUT', code == 0 and len(put) == 1)
body = put[0][2] if put else {}
yes('the default channels are the nine from r25n by id, in order',
    body.get('default_channel_ids') == [cid(g, n) for n in B.DEFAULT_CHANNELS])
yes('a real run switches onboarding on', body.get('enabled') is True)
titles = [p['title'] for p in body.get('prompts', [])]
yes('by default there is no hold question, so nobody gets Member from it',
    titles == ['What are you here for?'])
yes('by default no answer gives any role',
    all(not o['role_ids'] for p in body.get('prompts', []) for o in p['options']))
q2 = body['prompts'][-1] if body.get('prompts') else {}
yes('question two is pick several and optional',
    q2.get('single_select') is False and q2.get('required') is False)
want2 = {'Roleplay': 'tales', 'Just playing': 'general',
         'I want to help test': 'apply-to-playtest', 'I make videos': 'media'}
yes('question two: every answer shows the channel it was written to show, by id',
    dict((o['title'], o['channel_ids']) for o in q2.get('options', [])) ==
    dict((t, [cid(g, n)]) for t, n in want2.items()))
yes('question two never points at #test-these, which only testers can see',
    cid(g, 'test-these') not in [c for o in q2.get('options', []) for c in o['channel_ids']])

# 3. --grant-member puts the hold question back as r26n and r27n wrote it.
api = FakeApi(g)
code, text = run(['--grant-member'], api)
everything.append(text)
body = api.puts()[0][2] if api.puts() else {}
hold = [p for p in body.get('prompts', []) if p['title'] == 'Which hold does your character call home?']
yes('--grant-member: the hold question is there', code == 0 and len(hold) == 1)
hold = hold[0] if hold else {}
yes('the hold question is pick one and members must answer',
    hold.get('single_select') is True and hold.get('required') is True)
opts = dict((o['title'], o) for o in hold.get('options', []))
yes('the hold question has the ten answers',
    list(opts) == HOLDS + ['Not decided yet'])
yes('every hold gives Member plus its own Citizen role, by id',
    all(sorted(opts[h]['role_ids']) == sorted([rid(g, 'Member'), rid(g, 'Citizen of ' + h)])
        for h in HOLDS if h in opts))
yes('Not decided yet gives Member only',
    opts.get('Not decided yet', {}).get('role_ids') == [rid(g, 'Member')])
play = set(rid(g, n) for n in ('Owner', 'Dev', 'Moderator', 'Playtester', 'Banned'))
yes('no answer gives a role that opens the game, a staff role or Banned',
    not play & set(r for p in body.get('prompts', []) for o in p['options'] for r in o['role_ids']))
yes('nothing in the plan can name a role outside Member and the Citizen roles',
    all(r in B.ALLOWED_ROLES
        for p in B.plan(True, True, True)['prompts'] for o in p['options'] for r in o['roles']))

# 4. Rules and age are off unless asked for.
yes('rules and age are not in the default plan',
    [p['key'] for p in B.plan()['prompts']] == ['here-for'])
yes('rules and age are not in the --grant-member plan either',
    [p['key'] for p in B.plan(grant_member=True)['prompts']] == ['hold', 'here-for'])
api = FakeApi(g)
code, text = run(['--rules', '--age'], api)
everything.append(text)
body = api.puts()[0][2] if api.puts() else {}
ra = [p for p in body.get('prompts', []) if p['title'] in
      ('Have you read the rules?', 'Thornswood is eighteen and over. Are you?')]
yes('--rules --age: both questions are there, first', code == 0 and len(ra) == 2
    and body['prompts'][0]['title'] == 'Have you read the rules?')
yes('rules and age questions are required with one answer each, pointing at #rules',
    all(p['required'] and p['single_select'] and len(p['options']) == 1
        and p['options'][0]['channel_ids'] == [cid(g, 'rules')] for p in ra))

# 5. A role that is not there, or that carries a power, stops it.
g2 = opened()
g2['roles'] = roles(drop=('Citizen of Morthal',))
api = FakeApi(g2)
code, text = run(['--grant-member'], api)
everything.append(text)
yes('a missing Citizen role is named and nothing is sent',
    code == 1 and not api.puts() and 'Citizen of Morthal' in text)
g3 = opened()
g3['roles'] = roles(member_perms=VIEW | SEND | (1 << 3))
api = FakeApi(g3)
code, text = run(['--grant-member'], api)
everything.append(text)
yes('a Member role carrying Administrator is refused before anything is sent',
    code == 1 and not api.puts() and 'Administrator' in text)

# 6. A bot without Manage Server is told so, and nothing is sent.
api = FakeApi(opened(), bot_role='Member')
code, text = run([], api)
everything.append(text)
yes('a bot without Manage Server and Manage Roles is told, nothing sent',
    code == 1 and not api.puts() and 'Manage Server' in text)

# 7. Questions already there keep their ids.
old = dict(guild_id=GID, enabled=False, mode=0, default_channel_ids=[],
           prompts=[dict(id='777', title='What are you here for?', single_select=False,
                         required=False, options=[dict(id='888', title='Roleplay',
                                                       channel_ids=[], role_ids=[])]),
                    dict(id='999', title='Something else', options=[])])
api = FakeApi(opened(), onboarding=old)
code, text = run([], api)
everything.append(text)
body = api.puts()[0][2] if api.puts() else {}
q2 = body.get('prompts', [{}])[-1]
yes('an existing question keeps its id', q2.get('id') == '777')
yes('an existing answer keeps its id',
    [o.get('id') for o in q2.get('options', []) if o['title'] == 'Roleplay'] == ['888'])
yes('a question that is going away is named', 'Replaced: the question "Something else"' in text)

# 8. --off writes it and leaves it off; a Discord refusal is said and not hidden.
api = FakeApi(opened())
code, text = run(['--off'], api)
everything.append(text)
yes('--off sends enabled false', code == 0 and api.puts() and api.puts()[0][2]['enabled'] is False)
api = FakeApi(opened(), refuse_put='{"message": "Invalid Form Body"}')
code, text = run([], api)
everything.append(text)
yes('a refusal from Discord prints its reason and exits 1',
    code == 1 and 'Invalid Form Body' in text)

# 9. The words, and Discord's limits on them.
for p in B.plan(True, True, True)['prompts']:
    for o in p['options']:
        if len(o['title']) > B.OPTION_TITLE_MAX or len(o['description']) > B.OPTION_DESCRIPTION_MAX:
            yes('answer "%s" fits Discord\'s limits' % o['title'], False)
yes('every answer fits Discord\'s title and description limits', True)
words = json.dumps(B.plan(True, True, True), ensure_ascii=False) + '\n'.join(everything)
yes('no em dash in anything it says or sets', chr(0x2014) not in words)
yes('never the word player', 'player' not in words.lower())

# 10. The token.
os.environ['DISCORD_TOKEN'] = TOKEN
yes('the token appears in no output', TOKEN not in '\n'.join(everything))
lines = []
code = B.main(['--nonsense'], out=lines.append)
yes('an unknown option is refused before anything is read', code == 2)
del os.environ['DISCORD_TOKEN']
lines = []
code = B.main(['--check'], out=lines.append)
yes('no token: says so and stops', code == 2 and 'No token' in '\n'.join(lines))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
