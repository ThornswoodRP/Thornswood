"""
test-3317-holds.py

A category per hold, Raven Rock included (#3317).

Patrick, 22 Oct 2026: "The Holds also need a guards and court channel for the
Guards and cour members. Each hold needs an announcement chanel for the Hold
that Jarls of that Hold and the court can post to for needed IC info". On the
page he picked a category per hold (q-3317-hold-layout, A), the court with the
Steward and the guards apart (q-3317-hold-office-access, A), and Raven Rock the
same as the nine (q-3317-raven-rock, A). This proves:

  H1 every hold, Raven Rock last, is a category of its own with its
     announcements, its hall, its court and its guard channel, in that order,
     then its Court voice; the holds sit after In Character and Factions
  H2 the hall is today's hold channel, moved out of The Holds by name, and
     The Holds is retired; #choose-your-hold moved to In Character
  H3 the hall: its Citizen, Jarl and officers talk; another hold's citizen
     gets nothing
  H4 the announcements: its citizens and guards read and cannot post; the
     Jarl, Steward and Court post
  H5 the court: the Jarl, Steward and Court; not the guards, not citizens
  H6 the guard: the Jarl and the guards; not the court, not citizens
  H7 HOLD_STAFF (the council, gamemasters, loremasters, moderators, devs)
     talks in the hall, court and guard and reads the announcements, which
     the council posts in like every other; @everyone sees none
  H8 each hold's category is gated to that hold

Build-Discord.py is imported for real, under another name, so its __main__
block never runs. Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import importlib.util
import types


PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord  # noqa: F401
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

spec = importlib.util.spec_from_file_location(
    'build_discord_holds', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


class Role(object):
    def __init__(self, name, rid):
        self.name = name
        self.id = rid

    def __repr__(self):
        return '<role %s>' % self.name


everyone = Role('@everyone', 1)
rs = [everyone] + [Role(n, 10 + i) for i, (n, _, _, _) in enumerate(B.ROLES)]
guild = types.SimpleNamespace(default_role=everyone, me=Role('Thornswood Bot', 999), roles=rs)
roles = dict((r.name, r) for r in rs)
plan = dict(B.PLAN)


def can(ow, name):
    """'talk', 'read' or None for a role in a set of overwrites."""
    o = ow.get(roles[name])
    if o is None or o.view_channel is not True:
        return None
    return 'talk' if o.send_messages is not False else 'read'


# ------------------------------------------------------------------ H1 --
yes('H1 Raven Rock is a hold, the last one',
    B.HOLDS[-1] == 'Raven Rock' and len(B.HOLDS) == 10)
for h in B.HOLDS:
    slug = B.hold_slug(h)
    got = [(s['name'], s.get('mode'), s.get('hold')) for s in plan.get(h, [])]
    yes('H1 %s is a category: announcements, hall, court, guard, then the Court voice' % h,
        got == [(slug + '-announcements', 'holdread', h), (slug, 'hold', h),
                (slug + '-court', 'holdcourt', h), (slug + '-guard', 'holdguard', h),
                (h + ' Court', 'holdcourt', h)]
        and plan[h][-1]['kind'] == 'voice')
cats = [c for c, _ in B.PLAN]
last = cats.index(B.FACTIONS[-1])
yes('H1 the hold categories sit together, after In Character and the factions',
    cats[last + 1:last + 1 + len(B.HOLDS)] == B.HOLDS
    and cats.index('In Character') + 1 == cats.index(B.FACTIONS[0]))

# ------------------------------------------------------------------ H2 --
yes('H2 every hall is moved out of The Holds by its name',
    all(dict((s['name'], s) for s in plan[h])[B.hold_slug(h)].get('was')
        == (('The Holds', B.hold_slug(h)),) for h in B.HOLDS))
yes('H2 The Holds is retired and is no category of the plan',
    'The Holds' in B.RETIRED_CATEGORIES and 'The Holds' not in plan)
choose = [s for s in plan['In Character'] if s['name'] == 'choose-your-hold']
yes('H2 #choose-your-hold is in In Character, moved from The Holds',
    len(choose) == 1 and choose[0].get('was') == (('The Holds', 'choose-your-hold'),)
    and choose[0]['mode'] == 'testersread')

# ------------------------------------------------------------- H3 to H6 --
OFFICERS = ('Jarl of %s', '%s Court', 'Steward of %s', 'Guard of %s')
for h in ('Whiterun', 'Raven Rock'):
    slug = B.hold_slug(h)
    places = dict((s['name'], B.spec_overwrites(guild, s, roles)) for s in plan[h])
    hall = places[slug]
    yes('H3 %s hall: its Citizen, Jarl, Court, Steward and Guard talk' % h,
        all(can(hall, n % h) == 'talk' for n in ('Citizen of %s',) + OFFICERS))
    yes('H3 %s hall: a Citizen of Falkreath gets nothing' % h,
        can(hall, 'Citizen of Falkreath') is None)

    ann = places[slug + '-announcements']
    yes('H4 %s announcements: its citizens and guards read and cannot post' % h,
        can(ann, 'Citizen of ' + h) == 'read' and can(ann, 'Guard of ' + h) == 'read')
    yes('H4 %s announcements: the Jarl, Steward and Court post' % h,
        all(can(ann, n % h) == 'talk' for n in ('Jarl of %s', 'Steward of %s', '%s Court')))
    yes('H4 %s announcements: another hold\'s Jarl gets nothing' % h,
        can(ann, 'Jarl of Falkreath') is None)

    court = places[slug + '-court']
    yes('H5 %s court: the Jarl, Steward and Court talk' % h,
        all(can(court, n % h) == 'talk' for n in ('Jarl of %s', 'Steward of %s', '%s Court')))
    yes('H5 %s court: not the guards, not its citizens' % h,
        can(court, 'Guard of ' + h) is None and can(court, 'Citizen of ' + h) is None)

    guard = places[slug + '-guard']
    yes('H6 %s guard: the Jarl and the guards talk' % h,
        can(guard, 'Jarl of ' + h) == 'talk' and can(guard, 'Guard of ' + h) == 'talk')
    yes('H6 %s guard: not the Court, not the Steward, not its citizens' % h,
        all(can(guard, n % h) is None for n in ('%s Court', 'Steward of %s', 'Citizen of %s')))

    # ------------------------------------------------------------ H7 --
    yes('H7 %s: every one of HOLD_STAFF talks in the hall, court and guard' % h,
        all(can(places[c], n) == 'talk' for c in (slug, slug + '-court', slug + '-guard')
            for n in B.HOLD_STAFF))
    yes('H7 %s: in the announcements the council posts and the rest of HOLD_STAFF reads' % h,
        all(can(ann, n) == ('talk' if n in B.COUNCIL_ROLES else 'read') for n in B.HOLD_STAFF))
    yes('H7 %s: @everyone sees none of them' % h,
        all(ow[everyone].view_channel is False for ow in places.values()))
    yes('H7 %s: a Playtester with no hold gets nothing' % h,
        all(can(ow, 'Playtester') is None for ow in places.values()))

# ------------------------------------------------------------------ H8 --
for h in ('Whiterun', 'Raven Rock'):
    cow = B.category_overwrites(guild, h, roles)
    yes('H8 the %s category: its citizen in, another hold\'s out' % h,
        B.category_mode(h) == ('hold', None)
        and can(cow, 'Citizen of ' + h) == 'talk'
        and can(cow, 'Citizen of Falkreath') is None
        and cow[everyone].view_channel is False)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
