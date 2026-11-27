"""
test-7053-several-holds.py

Somebody can open several holds in #choose-your-hold and close any one of
them (#7053).

Patrick, 27 Nov 2026: a pick there "doesnt choose thwewir IC hold its just
the holds they wont access to in discord for those cannels so they dont have
extra clutter so let people click on more than one hold and than be able to
remove holds they dont want to have access to anymore". Until then the panel
gave one Citizen role at a time: a second pick took the first away.

So this checks:

  A  a press on a hold somebody does not have gives that hold's Citizen role
     and takes nothing away, so a second and a third hold join the first
  R  a press on a hold somebody has takes that one role off and leaves every
     other hold, their Jarl role and any other role alone
  S  each reply names the hold pressed and every hold open after the press,
     in the panel's order, worked out from the press itself: Discord sends
     the changed member later, so the member in hand still has the old roles
  G  somebody without Member or a staff role is given nothing
  P  the panel's words say several holds may be open and how to close one,
     and that it is not where a character lives; the plan's channel topic
     says the same; a panel posted with the old words is rewritten

bot.py and Apply-Discord.py are imported for real. Every guild, member and
interaction is a stand-in. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import importlib.util
import itertools
import types

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
for _k in ('HOLD_CHANNEL', 'MEMBER_ROLE', 'STAFF_ROLES'):
    os.environ.pop(_k, None)

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord  # noqa: F401
except ImportError:
    print('SKIP  discord.py is not installed here')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
H = sys.modules['bot_holds']
H.log = lambda *a: None
_ids = itertools.count(9000)


class Role(object):
    def __init__(self, name, position=1):
        self.id = next(_ids)
        self.name = name
        self.position = position

    def __lt__(self, other):
        return self.position < other.position

    def __repr__(self):
        return '<role %s>' % self.name


class Person(object):
    """Like discord.py's Member: add_roles and remove_roles ask Discord and
       leave .roles as it was; the change arrives later, as land() does."""
    def __init__(self, name, roles=()):
        self.id = next(_ids)
        self.name = self.display_name = name
        self.roles = list(roles)
        self.asked = []

    async def add_roles(self, *roles, reason=None):
        self.asked.extend(('add', r.name) for r in roles)

    async def remove_roles(self, *roles, reason=None):
        self.asked.extend(('remove', r.name) for r in roles)

    def land(self):
        for how, name in self.asked:
            r = ROLES[name]
            if how == 'add' and r not in self.roles:
                self.roles.append(r)
            elif how == 'remove' and r in self.roles:
                self.roles.remove(r)
        self.asked = []


TOP = Role('Thornswood', 200)
ROLES = dict((n, Role(n)) for n in ['Member', 'Playtester', 'Moderator', 'Jarl of Riften'] +
             ['Citizen of ' + h for h in H.HOLDS])
GUILD = types.SimpleNamespace(
    name='Thornswood', roles=list(ROLES.values()) + [TOP],
    me=types.SimpleNamespace(top_role=TOP,
                             guild_permissions=types.SimpleNamespace(manage_roles=True)))


class Interaction(object):
    def __init__(self, user):
        self.guild = GUILD
        self.user = user
        self.said = []
        self.response = types.SimpleNamespace(send_message=self._send)

    async def _send(self, text, ephemeral=False):
        self.said.append((text, ephemeral))


def press(who, hold):
    i = Interaction(who)
    asyncio.run(H.pick_hold(i, hold))
    asked = list(who.asked)
    who.land()
    return asked, (i.said[0][0] if i.said else ''), (i.said[0][1] if i.said else None)


def citizens(who):
    return [r.name[len('Citizen of '):] for r in who.roles if r.name.startswith('Citizen of ')]


# ------------------------------------------------------------------ A --
ann = Person('Ann', [ROLES['Member'], ROLES['Jarl of Riften']])
asked, said, private = press(ann, 'Whiterun')
yes('A a first press gives that hold and asks nothing else of Discord',
    asked == [('add', 'Citizen of Whiterun')] and citizens(ann) == ['Whiterun'])
asked, said, _ = press(ann, 'Riften')
yes('A a second hold joins the first, nothing is taken away',
    asked == [('add', 'Citizen of Riften')] and sorted(citizens(ann)) == ['Riften', 'Whiterun'])
asked, said3, _ = press(ann, 'Raven Rock')
yes('A a third hold joins too, Raven Rock included',
    asked == [('add', 'Citizen of Raven Rock')]
    and sorted(citizens(ann)) == ['Raven Rock', 'Riften', 'Whiterun'])

# ------------------------------------------------------------------ S --
yes('S the reply is only for them', private is True)
yes('S the reply says the hold pressed is open and names every hold open now, in '
    'the panel\'s order, though the member in hand had not changed yet',
    'Raven Rock channels are open' in said3
    and said3.endswith('Your holds: Whiterun, Riften, Raven Rock.'))

# ------------------------------------------------------------------ R --
asked, said, _ = press(ann, 'Riften')
yes('R a press on a hold they have takes off that one and asks nothing else',
    asked == [('remove', 'Citizen of Riften')]
    and citizens(ann) == ['Whiterun', 'Raven Rock'])
yes('R their Jarl role and Member stay',
    ROLES['Jarl of Riften'] in ann.roles and ROLES['Member'] in ann.roles)
yes('S the reply says that hold is closed and names the ones left',
    'Riften channels are closed' in said and said.endswith('Your holds: Whiterun, Raven Rock.'))
press(ann, 'Whiterun')
asked, said, _ = press(ann, 'Raven Rock')
yes('R the last one can be closed too, and the reply says none is open',
    citizens(ann) == [] and said.endswith('You have no holds open.'))

# ------------------------------------------------------------------ G --
nobody = Person('Nobody')
asked, said, _ = press(nobody, 'Whiterun')
yes('G somebody without Member or staff is given nothing and told why',
    asked == [] and 'Member role' in said)
staff = Person('Sam', [ROLES['Moderator']])
asked, said, _ = press(staff, 'Morthal')
yes('G staff may open a hold', asked == [('add', 'Citizen of Morthal')])

# ------------------------------------------------------------------ P --
words = H.HOLD_PANEL.lower()
yes('P the panel says several holds may be open, a second press closes one, and '
    'it is not where a character lives',
    'as many as you like' in words and 'again to close' in words
    and 'not where your character lives' in words
    and 'one hold at a time' not in words)
spec = importlib.util.spec_from_file_location('apply_discord', os.path.join(HERE, 'Apply-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
topic = [c for _, chans in B.PLAN for c in chans if c.get('name') == 'choose-your-hold'][0]['topic']
yes('P the plan\'s topic for #choose-your-hold says the same',
    'as many as you like' in topic.lower() and 'again to close' in topic.lower())
old = types.SimpleNamespace(
    content='**Choose your hold**\n\nPick the hold your character calls home and its '
            'channels open to you. One hold at a time: picking another moves you there, '
            'and pressing the one you have leaves it.',
    components=[types.SimpleNamespace(children=[types.SimpleNamespace(custom_id=i) for i in row])
                for row in H._hold_rows_wanted()])
yes('P a panel posted with the old words is not current, so the bot\'s start rewrites it',
    not H.hold_panel_is_current(old))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
