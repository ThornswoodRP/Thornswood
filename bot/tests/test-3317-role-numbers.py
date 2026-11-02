"""
test-3317-role-numbers.py

The role order Discord turned down (#3317).

The layout run of 22 Oct 2026, 3:22 PM box time, asked Discord to put the
roles in the plan's order in one request and Discord refused it whole: "the
roles were not put in order (400 Missing Permissions)". The read-only audit
from cfcefcea (#3317 comment 6351722611) measured why. The bot's highest role
is at position 110, but 125 roles sit under it, because Discord made the 16
Officer roles all at position 1, beside Updates Pings, and moved nothing up for
them. The build numbered its list 1 to 123, so it asked for positions 110 to
123, at or above the bot's own role, and Discord turns that down. Patreon and
Jockie Music, which their own bots manage, were left out of the list but
kept numbers in the middle of it.

This builds that server from the audit's own lines. The stand-in for Discord
does what Discord does: it refuses any position at or above the bot's role,
it lets positions repeat, and it sorts a shared position by id, older above.
This proves:

  N1 the old numbering, 1 to N, asks for positions at or above the bot's
     role on that server, and the stand-in refuses it the way Discord did
  N2 a build asks only for positions under the bot's role, in one request
  N3 afterwards every plan role is in the plan's order, Patreon included,
     and Jockie Music keeps its place
  N4 the build reads Discord's answer back and finds nothing out of place,
     and a second build asks for nothing
  N5 with room under the bot, every role gets a position of its own
  N6 roles that cannot fit even sharing positions are not asked for, and the
     run says why
  N7 rank sorts a shared position the way Discord does, older above, and
     order_slips sees a slip between two roles that share a position

Build-Discord.py is imported for real, under another name, so its __main__
block never runs. Never connects to anything.
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
    'build_discord_3317_numbers', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


# The audit's lines, top first: position, name, who manages it. The bot's own
# role (Thornswood, 110) and @everyone (0) are added by the stand-in.
LIVE = """
109 Owner
108 Co-Owner
107 Lead Dev
106 Lead Gamemaster
105 Lead Loremaster
104 Lead Moderator
103 Lead Content Creator
102 Lead Support
101 Dev
100 Gamemaster
99 Loremaster
98 Trial Gamemaster
97 Moderator
96 Content Creator
95 Support
94 Jarl of Whiterun
93 Jarl of Solitude
92 Jarl of Windhelm
91 Jarl of Riften
90 Jarl of Markarth
89 Jarl of Dawnstar
88 Jarl of Morthal
87 Jarl of Falkreath
86 Jarl of Winterhold
85 Jarl of Raven Rock
84 Imperial Embassy Leader
83 Server Booster|boost
82 Thalmor Leader
81 Free Skyrim Trading Company Leader
80 Vigilants of Stendarr Leader
79 College of Winterhold Leader
78 Bards College Leader
77 Thieves Guild Leader
76 Companions Leader
75 Dark Brotherhood Leader
74 Dawnguard Leader
73 Silver Hand Leader
72 Forsworn Leader
71 Orc Strongholds Leader
70 Khajiit Caravans Leader
69 Blades Leader
68 Volkihar Clan Leader
67 Playtester
66 Thalmor Boot-Licker
65 Talos Worshiper
64 Milk Drinker
63 Citizen of Whiterun
62 Citizen of Solitude
61 Citizen of Windhelm
60 Citizen of Riften
59 Citizen of Markarth
58 Citizen of Dawnstar
57 Citizen of Falkreath
56 Citizen of Winterhold
55 Citizen of Raven Rock
54 Whiterun Court
53 Steward of Whiterun
52 Guard of Whiterun
51 Solitude Court
50 Steward of Solitude
49 Guard of Solitude
48 Windhelm Court
47 Steward of Windhelm
46 Guard of Windhelm
45 Riften Court
44 Steward of Riften
43 Guard of Riften
42 Markarth Court
41 Steward of Markarth
40 Guard of Markarth
39 Citizen of Morthal
38 Dawnstar Court
37 Steward of Dawnstar
36 Jockie Music|bot 411916947773587456
35 Guard of Dawnstar
34 Morthal Court
33 Patreon|bot 216303189073461248
32 Steward of Morthal
31 Guard of Morthal
30 Falkreath Court
29 Steward of Falkreath
28 Guard of Falkreath
27 Imperial Embassy
26 Companions
25 Thalmor
24 College of Winterhold
23 Bards College
22 Thieves Guild
21 Dark Brotherhood
20 Vigilants of Stendarr
19 Dawnguard
18 Silver Hand
17 Forsworn
16 Orc Strongholds
15 Khajiit Caravans
14 Blades
13 Volkihar Clan
12 Business Owner
11 Winterhold Court
10 Steward of Winterhold
9 Guard of Winterhold
8 Raven Rock Court
7 Steward of Raven Rock
6 Guard of Raven Rock
5 Free Skyrim Trading Company
4 Member
3 Banned
2 News Pings
1 Updates Pings
"""

# The 16 Officer roles, made by the layout run of 22 Oct in the plan's order,
# all at position 1 (the audit lists them newest first, which is the order
# they were made in, backwards).
OFFICERS = [n for n, _c, _h, _p in B.ROLES if n.endswith(' Officer')]


class Tags(object):
    def __init__(self, bot_id=None, boost=False):
        self.bot_id = bot_id
        self.integration_id = None
        self.subscription_listing_id = None
        self._boost = boost

    def is_premium_subscriber(self):
        return self._boost

    def is_guild_connection(self):
        return False

    def is_bot_managed(self):
        return self.bot_id is not None


class Role(object):
    def __init__(self, guild, name, position, rid, tags=None):
        self.guild = guild
        self.name = name
        self.position = position
        self.id = rid
        self.tags = tags
        self.managed = tags is not None
        self.hoist = False
        self.permissions = discord.Permissions(0)

    def is_bot_managed(self):
        return bool(self.tags and self.tags.is_bot_managed())

    async def edit(self, **kw):
        self.guild.calls.append(('role.edit', self.name, sorted(kw)))
        if 'position' in kw:
            raise AssertionError('a role is never moved one at a time')
        for k in ('hoist', 'permissions'):
            if k in kw:
                setattr(self, k, kw[k])

    def __repr__(self):
        return '<role %s %d>' % (self.name, self.position)


class Refused(discord.HTTPException):
    def __init__(self):
        super().__init__(types.SimpleNamespace(status=400, reason='Bad Request'),
                         {'code': 50013, 'message': 'Missing Permissions'})


class Guild(object):
    """Discord as far as role positions go: positions may repeat, a shared
       one is sorted by id with the older above, and a request that asks
       for a position at or above the bot's own role is refused whole."""

    def __init__(self, live, ids_from_top=True):
        self.id = 1
        self.calls = []
        self.roles = []
        self.default_role = Role(self, '@everyone', 0, 1)
        self.roles.append(self.default_role)
        bot = Role(self, 'Thornswood', 110, 900, Tags(bot_id=1549251507361292418))
        self.roles.append(bot)
        rows = []
        for ln in live.strip().splitlines():
            pos, rest = ln.split(' ', 1)
            name, _bar, who = rest.partition('|')
            rows.append((int(pos), name, who))
        # Older roles sit higher, the way the server was built by hand and
        # then by the builder, top first; ids_from_top=False makes them the
        # other way round, the worst case for sharing a position.
        nid = 1000 if ids_from_top else 1000 + len(rows)
        for pos, name, who in rows:
            tags = None
            if who == 'boost':
                tags = Tags(boost=True)
            elif who.startswith('bot '):
                tags = Tags(bot_id=int(who.split()[1]))
            self.roles.append(Role(self, name, pos, nid, tags))
            nid += 1 if ids_from_top else -1
        for i, name in enumerate(OFFICERS):
            self.roles.append(Role(self, name, 1, 5000 + i))
        self.me = types.SimpleNamespace(id=bot.tags.bot_id, top_role=bot, roles=[bot])

    async def edit_role_positions(self, positions, reason=None):
        asked = dict((r.name, p) for r, p in positions.items())
        self.calls.append(('role positions', None, asked))
        top = self.me.top_role.position
        if any(p >= top for p in positions.values()):
            raise Refused()
        for r, p in positions.items():
            r.position = p
        return list(self.roles)

    async def create_role(self, name=None, **kw):
        self.calls.append(('create_role', name))
        r = Role(self, name, 1, 9000 + len(self.roles))
        self.roles.append(r)
        return r

    def top_down(self):
        return [r.name for r in sorted(self.roles, key=B.rank, reverse=True)]


def by_name(g):
    return dict((r.name, r) for r in g.roles)


def plan_of(g):
    want = set(n for n, _c, _h, _p in B.ROLES)
    return dict((r.name, r) for r in g.roles if r.name in want)


def in_plan_order(g):
    want = [n for n, _c, _h, _p in B.ROLES]
    return [n for n in g.top_down() if n in want] == want


def build(g):
    """ensure_roles as a build runs it: no -Check, no -Only."""
    B.CHECK = False
    B.ONLY = []
    del B.made[:]
    del B.kept[:]
    del B.failed[:]
    g.calls = []
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(B.ensure_roles(g))
    return buf.getvalue()


def asked(g):
    return [c[2] for c in g.calls if c[0] == 'role positions']


# ---- N1 the old numbering -------------------------------------------------
g = Guild(LIVE)
yes('N1 the stand-in is the audit\'s server: 125 roles under the bot at 110, 17 of them at 1',
    sum(1 for r in g.roles if 0 < r.position < 110) == 125
    and sum(1 for r in g.roles if r.position == 1) == 17)
order = B.role_order(g, plan_of(g))
old = dict((r, len(order) - i) for i, r in enumerate(order))
try:
    asyncio.run(g.edit_role_positions(old))
    refused = False
except discord.HTTPException as e:
    refused = '400' in B.refused(e) and 'Missing Permissions' in B.refused(e)
yes('  the old numbering, 1 to N, asks for a position at or above the bot\'s and is refused, '
    'as on 22 Oct', max(old.values()) >= 110 and refused)

# ---- N2 to N4 a build on that server ---------------------------------------
g = Guild(LIVE)
jockie_at = g.top_down().index('Jockie Music')
out = build(g)
req = asked(g)
yes('N2 a build sends one request', len(req) == 1)
yes('  and every position in it is under the bot\'s role',
    req and max(req[0].values()) < 110 and min(req[0].values()) >= 1)
yes('  and Discord took it: nothing in the did-not-manage list', B.failed == [])
yes('N3 every plan role is now in the plan\'s order', in_plan_order(g))
td = g.top_down()
yes('  Patreon, which its own bot manages, sits under Server Booster as the plan has it',
    td.index('Patreon') == td.index('Server Booster') + 1)
yes('  Jockie Music, which the plan does not name, keeps its place, %d from the top' % jockie_at,
    td.index('Jockie Music') == jockie_at)
yes('  the bot\'s own role is not in the request and is still the top',
    'Thornswood' not in req[0] and td[0] == 'Thornswood')
yes('N4 the build read Discord\'s answer back and found nothing out of place',
    'Discord took the role order but' not in ' '.join(B.failed))
yes('  and a second build asks for no role to move', B.role_order(g, plan_of(g)) is None)
out = build(g)
yes('  nor sends a request', asked(g) == [])

# The same server with its ids the other way round: younger roles higher,
# so far fewer roles can share a position.
g = Guild(LIVE, ids_from_top=False)
build(g)
req = asked(g)
yes('  ids the other way round: still under the bot and in the plan\'s order',
    req and max(req[0].values()) < 110 and in_plan_order(g) and B.failed == [])

# ---- N5 room for all --------------------------------------------------------
g = Guild(LIVE)
g.me.top_role.position = 200
build(g)
req = asked(g)
yes('N5 with room under the bot, every role gets a position of its own, 1 up',
    req and sorted(req[0].values()) == list(range(1, len(req[0]) + 1)) and in_plan_order(g))

# ---- N6 no room ------------------------------------------------------------
g = Guild(LIVE, ids_from_top=False)
for r in g.roles:
    if 0 < r.position < 110:
        r.position = min(r.position, 39)
g.me.top_role.position = 40
before = [(r.name, r.position) for r in g.roles]
build(g)
yes('N6 roles that cannot fit under the bot even sharing are not asked for',
    asked(g) == [] and [(r.name, r.position) for r in g.roles] == before)
yes('  and the run says why', any('do not fit in the 39 positions' in f for f in B.failed))

# role_positions on its own: shares only as many positions as it must.
class R(object):
    def __init__(self, i):
        self.id = i
        self.name = str(i)


rs = [R(i) for i in (10, 11, 12, 13)]
yes('  role_positions shares nothing when there is room',
    sorted(B.role_positions(rs, 4).values()) == [1, 2, 3, 4])
at = B.role_positions(rs, 2)
yes('  and with room for two, older above younger share, top two apart from the bottom two',
    at is not None and max(at.values()) == 2
    and [at[r] for r in rs] == sorted([at[r] for r in rs], reverse=True))
yes('  and younger above older cannot share, so it does not fit',
    B.role_positions(list(reversed(rs)), 3) is None)

# ---- N7 rank and order_slips ------------------------------------------------
g = Guild(LIVE)
by = by_name(g)
yes('N7 rank puts the older of two roles at one position above',
    B.rank(by['Imperial Embassy Officer']) > B.rank(by['Thalmor Officer'])
    and B.rank(by['Updates Pings']) > B.rank(by['Imperial Embassy Officer']))
by['Member'].position = by['Banned'].position = 3
by['Member'].id, by['Banned'].id = max(by['Member'].id, by['Banned'].id), min(by['Member'].id, by['Banned'].id)
slips = B.order_slips(plan_of(g))
yes('  order_slips sees Member under Banned when they share a position and Banned is older',
    ('Member', 'Banned') in slips)
yes('  and none between the Officers, which share position 1 in the plan\'s order',
    not any(a.endswith(' Officer') and b.endswith(' Officer') for a, b in slips))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
