"""
test-6961-changes-only.py

Issue #6961. A run applies only what the plan changed since the record of
the last run, and leaves everything else as the live server has it, hand
edits included.

Until then every run made the live server the whole plan, because nothing
said what the last run had applied. The run of 26 Nov 2026 that opened the
read channels also put 48 channels and categories back in the plan's order,
took Member's own member-list group away and replaced #general-chat's
permissions, all set by hand since 16 Nov.

What this checks, with the builder imported for real and every guild, role
and channel a stand-in that records what would have been asked of Discord:
  1. plan_state is plain JSON, the same every time, and a plan compared with
     itself has no changes;
  2. a live server that is the plan, and the record the plan: Discord is
     asked nothing and the record is left alone;
  3. hand edits (a role's overwrite on #general-chat, Member shown in its
     own group, two channels swapped) and no plan change: Discord is asked
     nothing, and the run lists all three as kept by hand;
  4. one overwrite the plan changed (a role on #lore): exactly that channel
     is edited, with that role's overwrite and every other one as it was,
     the hand edits stay, and the record moves on to the plan;
  5. -Check says it would change that overwrite, asks nothing, and leaves
     the record;
  6. a channel new to the plan is made and goes under the channel the plan
     has above it, and the hand order in its category stays;
  7. a post whose words changed is the only post written;
  8. Discord refusing a change leaves the record where it was;
  9. without a record a run stops before Discord is asked anything, and
     -Record writes one once and never over another;
 10. the audit log's changes read as words.

Never connects to anything.
"""
import os
import sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import contextlib
import copy
import importlib.util
import io
import itertools
import json
import shutil
import subprocess
import tempfile
import types

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


SCRIPT = os.path.join(HERE, 'Apply-Discord.py')
spec = importlib.util.spec_from_file_location('apply_discord_6961', SCRIPT)
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
discord = B.discord
IDS = itertools.count(5000)


class Role(object):
    def __init__(self, guild, name, position, permissions=0, hoist=False, managed=False):
        self.guild = guild
        self.name = name
        self.id = next(IDS)
        self.position = position
        self.permissions = discord.Permissions(permissions)
        self.hoist = hoist
        self.managed = managed
        self.members = []

    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        return getattr(other, 'id', None) == self.id

    async def edit(self, **kw):
        self.guild.calls.append(('role.edit', self.name, kw))
        if 'hoist' in kw:
            self.hoist = kw['hoist']
        if 'permissions' in kw:
            self.permissions = kw['permissions']


class Member(object):
    def __init__(self, role):
        self.id = 424242
        self.name = 'Thornswood'
        self.roles = [role]
        self.top_role = role
        self.bot = True

    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        return getattr(other, 'id', None) == self.id


class Channel(object):
    def __init__(self, guild, name, kind, category=None, topic=None, ow=None):
        self.guild = guild
        self.name = name
        self.kind = kind
        self.category = category
        self.topic = topic
        self.ow = dict(ow or {})
        self.id = next(IDS)
        self.position = self.id
        self.channels = []

    @property
    def type(self):
        if self.kind == 'voice':
            return discord.ChannelType.voice
        return discord.ChannelType.text

    @property
    def overwrites(self):
        return dict(self.ow)

    @property
    def mention(self):
        return '<#%d>' % self.id

    async def edit(self, **kw):
        self.guild.calls.append(('edit', self.name, kw))
        if self.guild.refuse:
            raise discord.HTTPException(types.SimpleNamespace(status=403, reason='Forbidden'),
                                        'Missing Permissions')
        if 'overwrites' in kw:
            self.ow = dict(kw['overwrites'])
        if 'topic' in kw:
            self.topic = kw['topic']


class Guild(object):
    def __init__(self):
        self.id = 1
        self.name = 'Thornswood stand-in'
        self.calls = []
        self.refuse = False
        self.roles = []
        self.categories = []
        self.channels = []
        self.default_role = Role(self, '@everyone', 0, B.PLAIN.value)
        self._state = types.SimpleNamespace(http=types.SimpleNamespace(
            bulk_channel_update=self._positions))

    async def _positions(self, guild_id, payload, reason=None):
        self.calls.append(('positions', None, payload))
        at = dict((p['id'], p['position']) for p in payload)
        for ch in self.channels + self.categories:
            if ch.id in at:
                ch.position = at[ch.id]

    async def create_text_channel(self, name, **kw):
        self.calls.append(('create_text_channel', name, kw))
        ch = Channel(self, name, 'text', category=kw.get('category'),
                     topic=kw.get('topic'), ow=kw.get('overwrites'))
        self.channels.append(ch)
        return ch

    def get_channel(self, cid):
        return next((c for c in self.channels if c.id == cid), None)

    async def onboarding(self):
        return types.SimpleNamespace(enabled=False, default_channel_ids=[])

    async def welcome_screen(self):
        return types.SimpleNamespace(welcome_channels=[])


async def _no_guide(guild):
    return {}
B.read_server_guide = _no_guide


def live_server():
    """A live server that is the plan exactly, made from plan_state."""
    g = Guild()
    state = B.plan_state()
    names = [n for n, _c, _h, _p in B.ROLES]
    top = Role(g, 'Thornswood', len(names) + 2, managed=True)
    g.roles.append(top)
    for i, (n, _c, h, p) in enumerate(B.ROLES):
        g.roles.append(Role(g, n, len(names) + 1 - i, p.value, h))
    g.roles.append(g.default_role)
    g.me = Member(top)

    def ows(pairs):
        out = {}
        for name, (a, d) in pairs.items():
            t = B._target(g, name)
            if t is not None:
                out[t] = discord.PermissionOverwrite.from_pair(discord.Permissions(a),
                                                               discord.Permissions(d))
        return out
    for catname, specs in B.PLAN:
        cat = None
        if catname:
            cat = Channel(g, catname, 'category', ow=ows(state['places'][catname]['overwrites']))
            g.categories.append(cat)
        for s in specs:
            if not s.get('make', True):
                continue
            key = B.place_key(catname, s)
            ch = Channel(g, B._place_name(key), s['kind'], category=cat,
                         ow=ows(state['places'][key]['overwrites']))
            g.channels.append(ch)
    # Topics last, so a topic's mention of a channel finds it.
    for catname, specs in B.PLAN:
        for s in specs:
            if s.get('make', True) and s['kind'] != 'voice':
                named(g, B._place_name(B.place_key(catname, s)), catname).topic = B.topic_text(g, s)
    return g, state


def named(g, name, cat):
    return next(c for c in g.channels if c.name == name
                and getattr(c.category, 'name', None) == cat)


TMP = tempfile.mkdtemp(prefix='ts-6961-')
RECORD = os.path.join(TMP, 'discord-applied.json')


def run(g, old, check=False):
    B.CHECK = check
    B.PRUNE = False
    B.WHOLE = False
    B.ROLES_ONLY = False
    B.ONLY = []
    B.AUDIT = False
    B.GIVE = []
    B.GUILD = ''
    B.OLD = old
    B.RECORD = RECORD
    B.client = types.SimpleNamespace(guilds=[g], get_guild=lambda _i: g, close=_close,
                                     user=types.SimpleNamespace(id=g.me.id))
    del B.made[:]
    del B.kept[:]
    del B.failed[:]
    g.calls = []
    if os.path.exists(RECORD):
        os.remove(RECORD)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(B.on_ready())
    return buf.getvalue()


async def _close():
    pass


try:
    # ---- 1 ----------------------------------------------------------------
    s1 = B.plan_state()
    s2 = B.plan_state()
    yes('plan_state is plain JSON', json.loads(json.dumps(s1)) == s1)
    yes('plan_state is the same every time', s1 == s2)
    yes('a plan compared with itself has no changes', B.plan_changes(s1, s2) == [])

    # ---- 2 ----------------------------------------------------------------
    g, state = live_server()
    out = run(g, copy.deepcopy(state))
    yes('the plan unchanged and the live server the plan: Discord is asked nothing',
        g.calls == [])
    yes('  it says the plan has not changed', 'has not changed' in out)
    yes('  and lists no hand edit', 'set by hand' not in out)
    yes('  and the record is left alone', not os.path.exists(RECORD))

    # ---- 3 ----------------------------------------------------------------
    g, state = live_server()
    gc = named(g, 'general-chat', 'Out of Character')
    member = next(r for r in g.roles if r.name == 'Member')
    gc.ow[member] = discord.PermissionOverwrite(view_channel=True, send_messages=True)
    member.hoist = True
    a, b = [c for c in g.channels if getattr(c.category, 'name', None) == 'Out of Character'
            and c.kind != 'voice'][:2]
    a.position, b.position = b.position, a.position
    out = run(g, copy.deepcopy(state))
    yes('hand edits and no plan change: Discord is asked nothing', g.calls == [])
    yes('  the hand overwrite on #general-chat is listed as kept',
        '#general-chat, Member' in out)
    yes('  Member shown in its own group is listed as kept',
        'role Member shows in its own member-list group' in out)
    yes('  the hand order is listed as kept', 'an order of their own' in out)

    # ---- 4 ----------------------------------------------------------------
    old = copy.deepcopy(state)
    del old['places']['Roleplay Guide/lore']['overwrites']['Lead Dev']
    lore = named(g, 'lore', 'Roleplay Guide')
    lead_dev = next(r for r in g.roles if r.name == 'Lead Dev')
    del lore.ow[lead_dev]
    before = dict(lore.ow)
    out = run(g, old)
    edits = [c for c in g.calls]
    yes('one overwrite the plan changed: only #lore is asked for',
        [(c[0], c[1]) for c in edits] == [('edit', 'lore')])
    got = edits[0][2]['overwrites'] if edits else {}
    yes('  with that role\'s overwrite as the plan has it',
        lead_dev in got and [v.value for v in got[lead_dev].pair()]
        == state['places']['Roleplay Guide/lore']['overwrites']['Lead Dev'])
    yes('  and every other overwrite on it as it was',
        dict((k, v) for k, v in got.items() if k != lead_dev) == before)
    yes('  it says what it changed, in words', 'access    #lore, Lead Dev allows' in out
        or '#lore, Lead Dev allows' in out)
    yes('  the hand overwrite on #general-chat stays', member in gc.ow)
    yes('  Member stays in its own group', member.hoist is True)
    yes('  the record moves on to the plan', os.path.exists(RECORD)
        and all(json.load(open(RECORD, encoding='utf-8'))[k] == state[k] for k in B.STATE_PARTS))

    # ---- 5 ----------------------------------------------------------------
    del lore.ow[lead_dev]
    out = run(g, old, check=True)
    yes('-Check asks nothing', g.calls == [])
    yes('  and says it would change that overwrite', 'would change' in out and '#lore, Lead Dev' in out)
    yes('  and leaves the record', not os.path.exists(RECORD))

    # ---- 6 ----------------------------------------------------------------
    g, state = live_server()
    tq = named(g, 'travelers-questions', 'Out of Character')
    g.channels.remove(tq)
    ooc = [c for c in g.channels if getattr(c.category, 'name', None) == 'Out of Character'
           and c.kind != 'voice']
    ooc[-1].position, ooc[-2].position = ooc[-2].position, ooc[-1].position
    hand = [c.name for c in sorted(ooc, key=lambda c: (c.position, c.id))]
    old = copy.deepcopy(state)
    del old['places']['Out of Character/travelers-questions']
    old['order']['Out of Character'].remove('travelers-questions')
    out = run(g, old)
    made = [c for c in g.calls if c[0] == 'create_text_channel']
    yes('a channel new to the plan is made', [c[1] for c in made] == ['travelers-questions'])
    now = [c.name for c in sorted((c for c in g.channels
                                   if getattr(c.category, 'name', None) == 'Out of Character'
                                   and c.kind != 'voice'), key=lambda c: (c.position, c.id))]
    plan = state['order']['Out of Character']
    above = plan[plan.index('travelers-questions') - 1]
    yes('  it goes straight under the channel the plan has above it',
        now.index('travelers-questions') == now.index(above) + 1)
    yes('  and the hand order of the rest stays',
        [n for n in now if n != 'travelers-questions'] == hand)
    yes('  nothing else is edited', [c for c in g.calls if c[0] == 'edit'] == [])

    # ---- 7 ----------------------------------------------------------------
    g, state = live_server()
    old = copy.deepcopy(state)
    old['posts']['LORE']['words'] = 'older words'
    out = run(g, old, check=True)
    yes('a post whose words changed is the only one said', out.count('would write') == 1
        and 'would write  #lore' in out.replace('would write #lore', 'would write  #lore'))

    # ---- 8 ----------------------------------------------------------------
    g, state = live_server()
    old = copy.deepcopy(state)
    del old['places']['Roleplay Guide/lore']['overwrites']['Lead Dev']
    lore = named(g, 'lore', 'Roleplay Guide')
    del lore.ow[next(r for r in g.roles if r.name == 'Lead Dev')]
    g.refuse = True
    out = run(g, old)
    yes('Discord refusing a change leaves the record where it was',
        not os.path.exists(RECORD) and 'was not moved on' in out)
    del B.failed[:]

    # ---- 9 ----------------------------------------------------------------
    env = dict(os.environ, DISCORD_TOKEN='', DISCORD_RECORD=RECORD, PYTHONIOENCODING='utf-8')
    for k in ('DISCORD_AUDIT', 'DISCORD_WHOLE', 'DISCORD_ONLY', 'DISCORD_GIVE', 'DISCORD_RECORD_NOW',
              'DISCORD_ROLES_ONLY', 'DISCORD_CHECK'):
        env.pop(k, None)
    if os.path.exists(RECORD):
        os.remove(RECORD)
    p = subprocess.run([sys.executable, SCRIPT], env=env, capture_output=True, text=True,
                       encoding='utf-8')
    yes('without a record a run stops before Discord is asked',
        p.returncode != 0 and 'There is no record' in p.stderr)
    p = subprocess.run([sys.executable, SCRIPT], env=dict(env, DISCORD_RECORD=''),
                       capture_output=True, text=True, encoding='utf-8')
    yes('  and without a record path too', p.returncode != 0 and 'No record' in p.stderr)
    p = subprocess.run([sys.executable, SCRIPT], env=dict(env, DISCORD_RECORD_NOW='1',
                                                          DISCORD_COMMIT='abc123'),
                       capture_output=True, text=True, encoding='utf-8')
    rec = json.load(open(RECORD, encoding='utf-8')) if os.path.exists(RECORD) else {}
    yes('-Record writes this plan as the record',
        p.returncode == 0 and all(rec.get(k) == s1[k] for k in B.STATE_PARTS)
        and rec.get('commit') == 'abc123')
    p = subprocess.run([sys.executable, SCRIPT], env=dict(env, DISCORD_RECORD_NOW='1'),
                       capture_output=True, text=True, encoding='utf-8')
    yes('  and never over a record already there',
        p.returncode != 0 and 'already' in p.stderr)

    # ---- 10 ---------------------------------------------------------------
    before = [('allow', discord.Permissions(view_channel=True)), ('position', 4)]
    after = [('allow', discord.Permissions(view_channel=True, send_messages=True)),
             ('position', 9)]
    words = B.change_words(before, after)
    yes('the audit log says a change as words',
        'allow +send_messages' in words and 'position 4 -> 9' in words)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
