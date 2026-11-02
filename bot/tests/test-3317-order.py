"""
test-3317-order.py

The sidebar in the plan's order, and the Voice category gone (#3317).

Patrick, 22 Oct 2026: "we need to delte the Voice category and proeprly move
each channel underntah it to it's proper channel, each hold needs a Court VC
... each Faction needs a VC, and we need to move the Help VC to under Support
and reanme it to SUpport and than the staff support vc to Support Staff", and
"better organize where each category goes on the left side" with "each
channel under every category is in an order that makes sense". This proves:

  O1 a server already in the plan's order is left alone
  O2 categories out of order are all put back, 0 up, in PLAN's order, and a
     category the plan does not name goes after them, as it was
  O3 a category's text channels are put back in the order its specs give,
     and its voices are not touched when they are already right
  O4 voices are ordered apart from text, as Discord draws them
  O5 -Check says what would move and writes nothing; a build sends every
     position in one request; a refusal is a failure, not a stop
  O6 the Voice category is retired and none of the plan; General, AFK and
     the jukebox are in Out of Character, moved by name; Help Voice becomes
     Support under Support; Support Voice becomes Support Staff
  O7 every hold has its Court voice and every faction its voice

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

PLACES = itertools.count(100)


class Place(object):
    def __init__(self, name, category=None, voice=False):
        self.name = name
        self.category = category
        self.id = next(PLACES)
        self.position = self.id
        self.type = (discord.ChannelType.voice if voice else
                     discord.ChannelType.text if category is not None else
                     discord.ChannelType.category)

    def __repr__(self):
        return '<%s>' % self.name


class Response(object):
    status = 403
    reason = 'Forbidden'


class Guild(object):
    id = 1
    name = 'Thornswood stand-in'

    def __init__(self):
        self.categories = []
        self.channels = []
        self.sent = []
        self.refuse = False
        self._state = types.SimpleNamespace(http=types.SimpleNamespace(
            bulk_channel_update=self._positions))

    async def _positions(self, guild_id, payload, reason=None):
        if self.refuse:
            raise discord.Forbidden(Response(), 'Missing Permissions')
        self.sent.append(payload)
        at = dict((p['id'], p['position']) for p in payload)
        for p in self.categories + self.channels:
            if p.id in at:
                p.position = at[p.id]


def build():
    """A guild with every planned place, made in the plan's order."""
    g = Guild()
    for catname, specs in B.PLAN:
        cat = Place(catname)
        g.categories.append(cat)
        for s in specs:
            voice = s['kind'] == 'voice'
            want = s['name'] if voice else s['name'].lower().replace(' ', '-')
            g.channels.append(Place(want, cat, voice))
    return g


def shown(places):
    return [p.name for p in sorted(places, key=lambda p: (p.position, p.id))]


def in_cat(g, catname, voice):
    cat = [c for c in g.categories if c.name == catname][0]
    return shown(ch for ch in g.channels
                 if ch.category is cat and B._is_voice(ch) == voice)


def run(g, check):
    B.CHECK = check
    del B.failed[:]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(B.keep_order(g))
    return buf.getvalue()


plan_cats = [c for c, _ in B.PLAN if c]

# ------------------------------------------------------------------ O1 --
g = build()
yes('O1 a server in the plan\'s order needs no move', B.order_wanted(g) == [])
out = run(g, False)
yes('O1   and a build sends nothing and says nothing', g.sent == [] and out == '')

# ------------------------------------------------------------------ O2 --
g = build()
by = dict((c.name, c) for c in g.categories)
by['Dev'].position, by['Start Here'].position = by['Start Here'].position, by['Dev'].position
odd = Place('Somebody Made This')
odd.position = by['Information'].position
g.categories.append(odd)
moves = B.order_wanted(g)
cats = [(p.name, n) for p, n in moves if p.type is discord.ChannelType.category]
yes('O2 categories out of order are all set, 0 up, in the plan\'s order',
    [n for _, n in cats] == list(range(len(plan_cats) + 1))
    and [c for c, _ in cats][:len(plan_cats)] == plan_cats)
yes('O2   and a category the plan does not name goes after them',
    cats[-1][0] == 'Somebody Made This')
yes('O2   and no channel is moved when every category\'s channels are right',
    all(p.type is discord.ChannelType.category for p, _ in moves))
run(g, False)
yes('O2 after a build the sidebar is the plan\'s, the stray category last',
    shown(g.categories) == plan_cats + ['Somebody Made This']
    and B.order_wanted(g) == [])

# ------------------------------------------------------------------ O3 --
g = build()
ooc = [c for c in g.categories if c.name == 'Out of Character'][0]
texts = [ch for ch in g.channels if ch.category is ooc and not B._is_voice(ch)]
texts[0].position, texts[-1].position = texts[-1].position, texts[0].position
moves = B.order_wanted(g)
yes('O3 a text channel out of place moves only that category\'s text',
    moves and all(p.category is ooc and not B._is_voice(p) for p, _ in moves)
    and sorted(n for _, n in moves) == list(range(len(texts))))
run(g, False)
want = [s['name'] for s in dict(B.PLAN)['Out of Character']
        if s['kind'] != 'voice']
yes('O3   and a build puts them in the order of the specs',
    in_cat(g, 'Out of Character', False) == want)

# ------------------------------------------------------------------ O4 --
g = build()
oc = [c for c in g.categories if c.name == 'Out of Character'][0]
voices = [ch for ch in g.channels if ch.category is oc and B._is_voice(ch)]
voices[0].position, voices[1].position = voices[1].position, voices[0].position
moves = B.order_wanted(g)
yes('O4 a voice out of place moves only the voices',
    moves and all(B._is_voice(p) and p.category is oc for p, _ in moves))
run(g, False)
yes('O4   and a build puts General before AFK, as the plan has them',
    in_cat(g, 'Out of Character', True) == ['General', 'AFK'])

# ------------------------------------------------------------------ O5 --
g = build()
by = dict((c.name, c) for c in g.categories)
by['Dev'].position, by['Lore'].position = by['Lore'].position, by['Dev'].position
before = [(p.name, p.position) for p in g.categories]
out = run(g, True)
yes('O5 -Check says what would move', 'would move' in out)
yes('O5   and writes nothing', g.sent == []
    and [(p.name, p.position) for p in g.categories] == before)
out = run(g, False)
yes('O5 a build sends every position in one request',
    len(g.sent) == 1 and len(g.sent[0]) == len(g.categories) and 'moved' in out)
g = build()
by = dict((c.name, c) for c in g.categories)
by['Dev'].position, by['Lore'].position = by['Lore'].position, by['Dev'].position
g.refuse = True
out = run(g, False)
yes('O5 a refused order is a failure the run reports, and the run goes on',
    any('order was not set' in f for f in B.failed))
B.CHECK = False
del B.failed[:]

# ------------------------------------------------------------------ O6 --
plan = dict(B.PLAN)
yes('O6 the Voice category is retired and none of the plan',
    'Voice' in B.RETIRED_CATEGORIES and 'Voice' not in plan
    and 'Voice' not in B.CATEGORY_MODE)
ooc = dict((s['name'], s) for s in plan['Out of Character'])
yes('O6 General, AFK and the jukebox are in Out of Character, moved from Voice',
    ooc['General'].get('was') == (('Voice', 'General'),)
    and ooc['AFK'].get('was') == (('Voice', 'AFK'),)
    and ooc['jukebox'].get('was') == (('Voice', 'jukebox'),))
sup = [s for s in plan['Support'] if s['kind'] == 'voice']
yes('O6 Support has the Support voice, from Help Voice, open to everybody, then Support Staff',
    [s['name'] for s in sup] == ['Support', 'Support Staff']
    and ('Voice', 'Help Voice') in sup[0].get('was', ())
    and sup[0]['mode'] == 'open'
    and sup[1].get('was') == (('Support', 'Support Voice'),))
yes('O6 no planned voice keeps a was in the Voice category it cannot reach',
    all(w[0] != 'Voice' or c in ('Out of Character', 'Support')
        for c, specs in B.PLAN for s in specs for w in s.get('was', ())))

# ------------------------------------------------------------------ O7 --
yes('O7 every hold has its Court voice, last in its category',
    all(plan[h][-1]['kind'] == 'voice' and plan[h][-1]['name'] == h + ' Court'
        and plan[h][-1]['mode'] == 'holdcourt' for h in B.HOLDS))
yes('O7 every faction has its voice, last in its own category',
    all(plan[f][-1]['kind'] == 'voice' and plan[f][-1]['name'] == f
        and plan[f][-1]['mode'] == 'faction' for f in B.FACTIONS))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
