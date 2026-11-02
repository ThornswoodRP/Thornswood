"""
test-3317-audit.py

Build-Discord.py --audit reads the live server, says where it differs from
the plan, and changes nothing (#3317).

Patrick, 22 Oct 2026: every role's permissions right globally, per category,
per channel and for the bot, and nobody holding two ranks of one staff
category. The plan only says what a channel the builder MAKES gets, and the
live server was gated by hand, so the audit is the read that says what is
really there.

Build-Discord.py is imported for real, under another name so its __main__
block never runs. The guild is a stand-in that matches the plan exactly, and
then is put wrong one way at a time; every write a stand-in could be asked
for is recorded, and none may happen.

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
import contextlib
import importlib.util
import io
import itertools
import types


PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

spec = importlib.util.spec_from_file_location(
    'build_discord', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

WRITES = []


class Role(object):
    def __init__(self, name, rid, perms):
        self.name = name
        self.id = rid
        self.permissions = discord.Permissions(perms.value if hasattr(perms, 'value') else perms)
        self.members = []
        self.managed = False
        self.position = 0

    async def edit(self, **kw):
        WRITES.append(('role edit', self.name))

    def __repr__(self):
        return '<role %s>' % self.name


class Member(object):
    def __init__(self, mid, name, roles):
        self.id = mid
        self.display_name = name
        self.roles = list(roles)
        for r in roles:
            r.members.append(self)


PLACES = itertools.count(100)


class Place(object):
    """A category or a channel. Any write is recorded. Made in the plan's
       order, so the sidebar is the plan's (#3317)."""

    def __init__(self, name, category=None, ow=None, voice=False):
        self.name = name
        self.category = category
        self.overwrites = dict(ow or {})
        self.id = next(PLACES)
        self.position = self.id
        self.type = (discord.ChannelType.voice if voice else
                     discord.ChannelType.text if category is not None else
                     discord.ChannelType.category)

        # A doc channel's post and its Changelog thread (#3336), filled in
        # by build() for the channels the plan writes.
        self.threads, self.msgs = [], []
        self.mention = '<#%d>' % self.id
        self.topic = None

    async def archived_threads(self, limit=None):
        for t in ():
            yield t

    async def history(self, limit=None, oldest_first=False):
        # Discord's order: newest first unless asked otherwise.
        for m in (list(self.msgs) if oldest_first else list(self.msgs)[::-1]):
            yield m

    def overwrites_for(self, target):
        return self.overwrites.get(target, discord.PermissionOverwrite())

    async def set_permissions(self, *a, **kw):
        WRITES.append(('set_permissions', self.name))

    async def edit(self, **kw):
        WRITES.append(('edit', self.name))

    async def delete(self, **kw):
        WRITES.append(('delete', self.name))


class Guild(object):
    name = 'Thornswood stand-in'

    async def create_role(self, *a, **kw):
        WRITES.append(('create_role',))

    async def create_category(self, *a, **kw):
        WRITES.append(('create_category',))

    async def create_text_channel(self, *a, **kw):
        WRITES.append(('create_text_channel',))

    async def edit(self, **kw):
        WRITES.append(('guild edit',))

    onboarding_enabled = False

    async def onboarding(self):
        return types.SimpleNamespace(enabled=self.onboarding_enabled)

    async def edit_onboarding(self, **kw):
        WRITES.append(('edit_onboarding',))


def build():
    """A guild exactly as the plan has it."""
    g = Guild()
    g.default_role = Role('@everyone', 1, B.PLAIN)
    g.roles = [g.default_role]
    rid = 100
    for i, (name, _, _, perms) in enumerate(B.ROLES):
        rid += 1
        g.roles.append(Role(name, rid, perms))
        g.roles[-1].position = len(B.ROLES) - i + 1   # the plan's order
    bot_role = Role('Thornswood Bot', 99, B.RUN_PERMISSIONS)
    bot_role.managed = True   # Discord's own role for a bot, as on the live server
    bot_role.position = len(B.ROLES) + 2
    g.roles.append(bot_role)
    g.me = Member(5, 'Thornswood', [bot_role])
    g.me.guild_permissions = discord.Permissions(B.RUN_PERMISSIONS | (1 << 3))  # it keeps Administrator (#3317)
    named = dict((r.name, r) for r in g.roles)
    g.members = [g.me,
                 Member(10, 'Patrick', [named['Owner'], named['Dev']]),
                 Member(11, 'Djinn', [named['Lead Gamemaster']]),
                 Member(12, 'A gamemaster', [named['Gamemaster']]),
                 Member(13, 'A tester', [named['Playtester'], named['Member']])]
    roles = dict((n, named[n]) for n, _, _, _ in B.ROLES)
    g.categories, g.channels = [], []
    planned = []
    for catname, specs in B.PLAN:
        cat = Place(catname, None, B.category_overwrites(g, catname, roles))
        g.categories.append(cat)
        for s in specs:
            if not s.get('make', True):
                continue
            want = s['name'].lower().replace(' ', '-') if s['kind'] != 'voice' else s['name']
            g.channels.append(Place(want, cat, B.spec_overwrites(g, s, roles),
                                    voice=s['kind'] == 'voice'))
            planned.append((g.channels[-1], s))
            if s.get('post') and s.get('key') not in B.C.DRAFTS:
                doc_in_order(g.channels[-1], s['key'], g.me.id)
    # Each topic as the build sets it, once every channel it names is there.
    for ch, s in planned:
        ch.topic = B.topic_text(g, s)
    return g, named


def doc_in_order(ch, key, me_id):
    """A doc channel as -Posts leaves it: its post linking its Changelog
       thread, which holds every change line (#3336)."""
    def said(text):
        return types.SimpleNamespace(author=types.SimpleNamespace(id=me_id), content=text,
                                     type=discord.MessageType.default)
    t = Place(B.CHANGELOG, ch)
    t.msgs = [said(l) for l in B.change_lines(key)]
    ch.threads = [t]
    ch.msgs = [said(B.doc_with_footer(key, t))]


def run(g):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        n = asyncio.run(B.audit(g))
    return n, buf.getvalue()


# --------------------------------------------------------- the clean guild --
g, named = build()
n, out = run(g)
yes('a server that matches the plan has no difference', n == 0)
yes('the audit says nothing was changed', 'Nothing was changed.' in out)
yes('the audit asked Discord for nothing', WRITES == [])
yes('every doc channel\'s changelog is read and in order', '  Changelogs' in out and 'Changelog thread' not in out)

# --------------------------------------------- a doc without its changelog --
g, named = build()
rules = [c for c in g.channels if c.name == 'rules'][0]
rules.threads = []
n, out = run(g)
yes('a doc channel with no Changelog thread is a difference (#3336)',
    n == 1 and 'DIFFERS  #rules, it has no Changelog thread; -Posts makes it' in out)
yes('who holds a staff rank is said', 'Lead Gamemaster: Djinn' in out)
yes('a non-staff role is said as a count, not names', 'Playtester: 1 member(s)' in out
    and 'A tester' not in out)

# --------------------------------------------------------------- a double --
g, named = build()
g.members.append(Member(20, 'Two hats', [named['Gamemaster'], named['Trial Gamemaster']]))
n, out = run(g)
yes('two ranks of the Gamemasters are a double',
    'Two hats holds Gamemaster and Trial Gamemaster, two ranks of Gamemasters' in out)
yes('a double is one difference', n == 1)

g, named = build()
yes('ranks in two categories are not a double',
    B.doubles([Member(21, 'x', [named['Dev'], named['Gamemaster']])]) == [])
yes('Owner beside a rank is not a double',
    B.doubles([Member(22, 'y', [named['Owner'], named['Lead Gamemaster']])]) == [])

# -------------------------------------------------- staff and a seat --
# Patrick, 22 Oct, 11:03 AM: no staff role may also be a faction leader, and a
# Jarl is one.
g, named = build()
g.members.append(Member(23, 'Two seats', [named['Moderator'], named['Jarl of Riften']]))
n, out = run(g)
yes('a staff member holding a Jarl seat is said',
    'Two seats is on staff (Moderator) and holds Jarl of Riften; staff hold no seat' in out and n == 1)
g, named = build()
yes('a faction leader on staff is a clash, a Citizen on staff is not',
    len(B.seat_clashes([Member(24, 'a', [named['Lead Support'], named['Thalmor Leader']])])) == 1 and
    B.seat_clashes([Member(25, 'b', [named['Dev'], named['Citizen of Whiterun']])]) == [])
yes('every faction in factions.json has its leader role, every Jarl is a seat',
    len(B.FACTION_LEADERS) == len(B.FACTIONS) and 'Jarl of Raven Rock' in B.SEATS
    and 'Free Skyrim Trading Company Leader' in B.SEATS)

# ----------------------------------------------------------- role order --
g, named = build()
named['Playtester'].position, named['Patreon'].position = \
    named['Patreon'].position, named['Playtester'].position
n, out = run(g)
yes('a role below one the plan puts under it is said',
    'role Patreon sits below Playtester; the plan has it above' in out)
yes('every staff role is above every seat and every other role',
    max(i for i, r in enumerate(B.ROLES) if r[0] in B.STAFF) <
    min(i for i, r in enumerate(B.ROLES) if r[0] not in B.STAFF))
yes('leads and Support give roles, nobody else below Co-Owner does',
    all(B.COUNCIL.manage_roles for _ in [0]) and B.SUPPORT.manage_roles and
    not B.MOD.manage_roles and not B.GM.manage_roles)

# ------------------------------------------------- a role with too much --
g, named = build()
named['Moderator'].permissions = discord.Permissions(B.MOD.value | discord.Permissions(administrator=True).value)
n, out = run(g)
yes('a role holding more than the plan is said',
    'role Moderator holds more than the plan: administrator' in out)

g, named = build()
g.roles.append(Role('Hand made', 500, discord.Permissions(manage_guild=True)))
n, out = run(g)
yes('a role the plan does not name is said with what it holds',
    'role Hand made is not in the plan, holds manage_guild' in out)

# ----------------------------------------------------------------- the bot --
g, named = build()
g.me.guild_permissions = discord.Permissions(administrator=True)
n, out = run(g)
yes('the bot holding Administrator, which it keeps (#3317), is no difference',
    'the bot holds Administrator, which it keeps' in out and n == 0)

g, named = build()
g.me.guild_permissions = discord.Permissions(B.RUN_PERMISSIONS & ~(1 << 28))
n, out = run(g)
yes('the bot without Administrator is a difference, and so is one of its running '
    'set missing', 'the bot does not hold Administrator, which it keeps' in out
    and 'the bot is missing manage_roles' in out)

# --------------------------------------------------------------- channels --
g, named = build()
gm_chat = [c for c in g.channels if c.name == 'gm-chat'][0]
gm_chat.overwrites[named['Playtester']] = discord.PermissionOverwrite(view_channel=True)
n, out = run(g)
yes('a role let into a channel the plan shuts it out of is said',
    '#gm-chat, Playtester: not in the plan, has allow view_channel' in out)

g, named = build()
rules = [c for c in g.channels if c.name == 'staff-general'][0]
rules.overwrites[g.default_role] = discord.PermissionOverwrite()
n, out = run(g)
yes('@everyone no longer shut out of a staff channel is said',
    '#staff-general, @everyone: view_channel is unset, plan denied' in out)

g, named = build()
staff = [c for c in g.categories if c.name == 'Staff'][0]
g.channels.append(Place('secret-room', staff, {}))
# #test-results is in KEEP, the name #test-findings had until 11 Oct, and no
# line of the plan's.
g.channels.append(Place('test-results', staff, {}))
n, out = run(g)
yes('a channel the plan does not name is said', '#secret-room in Staff is not in the plan' in out)
yes('a channel KEEP names and the plan does not is kept by name, not a difference',
    '#test-results in Staff is kept by name' in out and n == 1)

g, named = build()
g.channels = [c for c in g.channels if c.name != 'gm-rules']
n, out = run(g)
yes('a planned channel that is missing is said', '#gm-rules is not in Gamemasters' in out)

# ----------------------------------------------------------- topics --
# Patrick, 23 Oct: #general-chat's description sent bug reports to #unknown,
# a channel deleted since.
g, named = build()
by = dict((c.name, c) for c in g.channels)
gc = by['general-chat']
yes('#general-chat\'s topic in the plan mentions #test-findings and #media by id',
    by['test-findings'].mention in gc.topic and by['media'].mention in gc.topic
    and '<#RESULTS>' not in gc.topic)
gc.topic = gc.topic.replace(by['test-findings'].mention, '<#987654321>')
n, out = run(g)
yes('a topic naming a channel that is gone is said, with the #unknown Discord shows',
    "#general-chat's topic names a channel that is gone (<#987654321>" in out
    and '#unknown' in out)
yes('  and differing from the plan is said too, with both texts',
    '#general-chat has the topic "' in out and n == 2)
g, named = build()
by = dict((c.name, c) for c in g.channels)
by['media'].topic = 'Old words.'
n, out = run(g)
yes('a topic the plan words differently is one difference',
    n == 1 and '#media has the topic "Old words."; the plan has "' in out)
g, named = build()
staff = [c for c in g.categories if c.name == 'Staff'][0]
odd = Place('secret-room', staff, {})
odd.topic = 'Ask in <#123>.'
g.channels.append(odd)
n, out = run(g)
yes('a channel outside the plan naming a gone channel in its topic is said',
    "#secret-room's topic names a channel that is gone (<#123>" in out)
yes('every text, forum and announcement channel the plan makes has a topic',
    [s['name'] for _c, specs in B.PLAN for s in specs
     if s['kind'] != 'voice' and s.get('make', True) and not s.get('topic')] == [])

yes('nothing in any run asked Discord for anything', WRITES == [])

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
